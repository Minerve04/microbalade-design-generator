CREATE OR REPLACE FUNCTION public.sync_commune_partner_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_active boolean;
BEGIN
  is_active := NEW.status_abonnement IN ('active', 'trialing', 'en_attente_mandat');

  INSERT INTO public.communes_partenaires (commune_user_id, nom, code_postal, logo_url, lien_action, active)
  VALUES (
    NEW.user_id,
    COALESCE(NEW.nom_collectivite, 'Commune'),
    COALESCE(NEW.code_postal, ''),
    NEW.logo_url,
    NEW.lien_action,
    is_active
  )
  ON CONFLICT (commune_user_id) DO UPDATE
    SET active = EXCLUDED.active,
        nom = COALESCE(public.communes_partenaires.nom, EXCLUDED.nom),
        code_postal = COALESCE(NULLIF(public.communes_partenaires.code_postal, ''), EXCLUDED.code_postal),
        logo_url = COALESCE(public.communes_partenaires.logo_url, EXCLUDED.logo_url),
        lien_action = COALESCE(public.communes_partenaires.lien_action, EXCLUDED.lien_action),
        updated_at = now();
  RETURN NEW;
END;
$function$;

-- Ensure unique constraint exists for ON CONFLICT
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communes_partenaires_commune_user_id_key'
  ) THEN
    ALTER TABLE public.communes_partenaires
      ADD CONSTRAINT communes_partenaires_commune_user_id_key UNIQUE (commune_user_id);
  END IF;
END $$;

-- Ensure trigger exists on commune_profiles
DROP TRIGGER IF EXISTS trg_sync_commune_partner_active ON public.commune_profiles;
CREATE TRIGGER trg_sync_commune_partner_active
AFTER INSERT OR UPDATE OF status_abonnement, nom_collectivite, code_postal, logo_url, lien_action
ON public.commune_profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_commune_partner_active();

-- Backfill: créer les fiches partenaires manquantes pour les communes actives
INSERT INTO public.communes_partenaires (commune_user_id, nom, code_postal, logo_url, lien_action, active)
SELECT cp.user_id,
       COALESCE(cp.nom_collectivite, 'Commune'),
       COALESCE(cp.code_postal, ''),
       cp.logo_url,
       cp.lien_action,
       true
FROM public.commune_profiles cp
WHERE cp.status_abonnement IN ('active', 'trialing', 'en_attente_mandat')
  AND NOT EXISTS (
    SELECT 1 FROM public.communes_partenaires p WHERE p.commune_user_id = cp.user_id
  );