ALTER TABLE public.commune_profiles ALTER COLUMN status_abonnement SET DEFAULT 'incomplete';

CREATE OR REPLACE FUNCTION public.handle_new_commune_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.commune_profiles (user_id, email, nom_collectivite, status_abonnement)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nom_collectivite', split_part(NEW.email, '@', 1)),
    'incomplete');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.commune_profiles_billing_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role'
     OR current_user IN ('postgres','supabase_admin')
     OR coalesce(current_setting('app.bypass_billing_guard', true), '') = 'on'
     OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin')) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status_abonnement := 'incomplete';
    NEW.mode_paiement := 'stripe';
    NEW.chorus_status := NULL;
    NEW.chorus_requested_at := NULL;
    NEW.chorus_paid_at := NULL;
    NEW.chorus_due_date := NULL;
    NEW.abonnement_prix_annuel := 600;
    NEW.abonnement_label := 'Abonnement Petite Ville';
    NEW.stripe_customer_id := NULL;
  ELSE
    NEW.status_abonnement := OLD.status_abonnement;
    NEW.mode_paiement := OLD.mode_paiement;
    NEW.chorus_status := OLD.chorus_status;
    NEW.chorus_requested_at := OLD.chorus_requested_at;
    NEW.chorus_paid_at := OLD.chorus_paid_at;
    NEW.chorus_due_date := OLD.chorus_due_date;
    NEW.stripe_customer_id := OLD.stripe_customer_id;
    NEW.abonnement_prix_annuel := OLD.abonnement_prix_annuel;
    NEW.abonnement_label := OLD.abonnement_label;
    NEW.abonnement_renouvellement := OLD.abonnement_renouvellement;
    NEW.user_id := OLD.user_id;
    NEW.email := OLD.email;
    IF OLD.code_postal IS NOT NULL AND btrim(OLD.code_postal) <> '' THEN
      NEW.code_postal := OLD.code_postal;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commune_profiles_billing_guard ON public.commune_profiles;
CREATE TRIGGER trg_commune_profiles_billing_guard
BEFORE INSERT OR UPDATE ON public.commune_profiles
FOR EACH ROW EXECUTE FUNCTION public.commune_profiles_billing_guard();

CREATE OR REPLACE FUNCTION public.request_chorus(p_siret text, p_numero_engagement text, p_code_service text, p_adresse text, p_email_compta text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_siret text := regexp_replace(coalesce(p_siret,''), '\s', '', 'g');
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;
  IF v_siret !~ '^\d{14}$' THEN RAISE EXCEPTION 'SIRET invalide (14 chiffres attendus)'; END IF;
  IF coalesce(p_email_compta,'') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RAISE EXCEPTION 'Email comptabilité invalide'; END IF;
  IF coalesce(btrim(p_adresse),'') = '' THEN RAISE EXCEPTION 'Adresse de facturation requise'; END IF;

  SELECT status_abonnement INTO v_status FROM public.commune_profiles WHERE user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profil introuvable'; END IF;
  IF v_status = 'active' THEN RAISE EXCEPTION 'Abonnement déjà actif'; END IF;

  PERFORM set_config('app.bypass_billing_guard', 'on', true);
  UPDATE public.commune_profiles SET
    siret = v_siret,
    numero_engagement = nullif(btrim(coalesce(p_numero_engagement,'')), ''),
    code_service_chorus = nullif(btrim(coalesce(p_code_service,'')), ''),
    adresse_facturation = btrim(p_adresse),
    email_comptabilite = btrim(p_email_compta),
    mode_paiement = 'chorus',
    status_abonnement = 'en_attente_mandat',
    chorus_status = 'pending',
    chorus_requested_at = now(),
    chorus_due_date = current_date + 30
  WHERE user_id = v_uid;
  PERFORM set_config('app.bypass_billing_guard', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.request_chorus(text,text,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_chorus(text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_commune_partner_active()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE is_active boolean;
BEGIN
  is_active := NEW.status_abonnement IN ('active', 'en_attente_mandat');
  INSERT INTO public.communes_partenaires (commune_user_id, nom, code_postal, logo_url, lien_action, active)
  VALUES (NEW.user_id, COALESCE(NEW.nom_collectivite, 'Commune'), COALESCE(NEW.code_postal, ''), NEW.logo_url, NEW.lien_action, is_active)
  ON CONFLICT (commune_user_id) DO UPDATE SET
    active = EXCLUDED.active,
    nom = COALESCE(NULLIF(EXCLUDED.nom, ''), public.communes_partenaires.nom),
    code_postal = COALESCE(NULLIF(EXCLUDED.code_postal, ''), public.communes_partenaires.code_postal),
    logo_url = COALESCE(NULLIF(EXCLUDED.logo_url, ''), public.communes_partenaires.logo_url),
    lien_action = COALESCE(NULLIF(EXCLUDED.lien_action, ''), public.communes_partenaires.lien_action),
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Logos partenaires visibles si actifs ou abonnes" ON public.communes_partenaires;
CREATE POLICY "Logos partenaires visibles si actifs ou abonnes" ON public.communes_partenaires
FOR SELECT TO public USING (
  active = true AND (commune_user_id IS NULL OR EXISTS (
    SELECT 1 FROM public.commune_profiles cp
    WHERE cp.user_id = communes_partenaires.commune_user_id
      AND cp.status_abonnement IN ('active','en_attente_mandat'))));

DROP POLICY IF EXISTS "Commune gère sa fiche partenaire" ON public.communes_partenaires;
DROP POLICY IF EXISTS "Commune g re sa fiche partenaire" ON public.communes_partenaires;

DROP POLICY IF EXISTS "Public peut insérer des stats" ON public.statistiques_recherches;
CREATE INDEX IF NOT EXISTS idx_stats_cp_created ON public.statistiques_recherches (code_postal, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_login_attempts TO service_role;
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip ON public.admin_login_attempts (ip, created_at DESC);