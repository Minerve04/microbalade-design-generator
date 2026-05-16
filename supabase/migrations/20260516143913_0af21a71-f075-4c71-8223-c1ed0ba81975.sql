-- 1. Champs Chorus sur commune_profiles
ALTER TABLE public.commune_profiles
  ADD COLUMN IF NOT EXISTS siret text,
  ADD COLUMN IF NOT EXISTS numero_engagement text,
  ADD COLUMN IF NOT EXISTS code_service_chorus text,
  ADD COLUMN IF NOT EXISTS adresse_facturation text,
  ADD COLUMN IF NOT EXISTS email_comptabilite text,
  ADD COLUMN IF NOT EXISTS mode_paiement text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS chorus_status text,
  ADD COLUMN IF NOT EXISTS chorus_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS chorus_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS chorus_due_date date;

-- 2. Mise à jour du trigger pour inclure en_attente_mandat
CREATE OR REPLACE FUNCTION public.sync_commune_partner_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.communes_partenaires
  SET active = (NEW.status_abonnement IN ('active', 'trialing', 'en_attente_mandat')),
      updated_at = now()
  WHERE commune_user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- 3. Mise à jour de la policy publique des logos
DROP POLICY IF EXISTS "Logos partenaires visibles si actifs ou abonn s" ON public.communes_partenaires;
CREATE POLICY "Logos partenaires visibles si actifs ou abonnes"
ON public.communes_partenaires
FOR SELECT
TO public
USING (
  active = true
  AND (
    commune_user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.commune_profiles cp
      WHERE cp.user_id = communes_partenaires.commune_user_id
        AND cp.status_abonnement IN ('active', 'trialing', 'en_attente_mandat')
    )
  )
);

-- 4. Rôles utilisateurs
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Permettre aux admins de voir/modifier tous les profils commune (pour back-office Chorus)
DROP POLICY IF EXISTS "Admins voient tous les profils" ON public.commune_profiles;
CREATE POLICY "Admins voient tous les profils" ON public.commune_profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins modifient les profils" ON public.commune_profiles;
CREATE POLICY "Admins modifient les profils" ON public.commune_profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));