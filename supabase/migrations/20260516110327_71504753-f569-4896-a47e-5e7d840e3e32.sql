-- 1. SUBSCRIPTIONS TABLE (standard Stripe schema)
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  product_id text NOT NULL,
  price_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_id ON public.subscriptions(stripe_subscription_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.has_active_subscription(
  user_uuid uuid,
  check_env text DEFAULT 'live'
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
      AND environment = check_env
      AND (
        (status IN ('active', 'trialing') AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  );
$$;

-- 2. COMMUNE_PROFILES: Stripe columns
ALTER TABLE public.commune_profiles
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN status_abonnement text NOT NULL DEFAULT 'trialing';

-- 3. COMMUNES_PARTENAIRES: link to user
ALTER TABLE public.communes_partenaires
  ADD COLUMN commune_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_communes_partenaires_user ON public.communes_partenaires(commune_user_id);

-- 4. Replace public RLS so logos linked to a user require an active commune profile
DROP POLICY IF EXISTS "Communes partenaires actives visibles par tous" ON public.communes_partenaires;

CREATE POLICY "Logos partenaires visibles si actifs ou abonn s"
  ON public.communes_partenaires FOR SELECT
  TO public
  USING (
    active = true
    AND (
      commune_user_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.commune_profiles cp
        WHERE cp.user_id = communes_partenaires.commune_user_id
          AND cp.status_abonnement IN ('active', 'trialing')
      )
    )
  );

-- Allow commune owners to manage their own partner row (logo, lien)
CREATE POLICY "Commune g re sa fiche partenaire"
  ON public.communes_partenaires FOR ALL
  TO authenticated
  USING (commune_user_id = auth.uid())
  WITH CHECK (commune_user_id = auth.uid());

-- 5. Trigger: when commune_profiles.status_abonnement changes,
--    mirror to communes_partenaires.active (only for linked rows).
CREATE OR REPLACE FUNCTION public.sync_commune_partner_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.communes_partenaires
  SET active = (NEW.status_abonnement IN ('active', 'trialing')),
      updated_at = now()
  WHERE commune_user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_commune_partner_active
AFTER INSERT OR UPDATE OF status_abonnement ON public.commune_profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_commune_partner_active();