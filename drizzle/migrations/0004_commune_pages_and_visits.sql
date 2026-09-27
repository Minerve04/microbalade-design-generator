CREATE OR REPLACE FUNCTION public.slugify_commune(_txt text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT nullif(btrim(regexp_replace(
    translate(
      replace(replace(lower(
        regexp_replace(btrim(coalesce(_txt,'')), '^(mairie|ville|commune)\s+(de\s+la\s+|de\s+l''|d''|de\s+|du\s+|des\s+)?', '', 'i')
      ), 'œ','oe'), 'æ','ae'),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z0-9]+', '-', 'g'), '-'), '')
$$;

ALTER TABLE public.communes_partenaires ADD COLUMN IF NOT EXISTS slug text;

CREATE OR REPLACE FUNCTION public.communes_partenaires_set_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE base text; cand text;
BEGIN
  IF NEW.slug IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.nom IS NOT DISTINCT FROM OLD.nom) THEN
    RETURN NEW;
  END IF;
  base := coalesce(public.slugify_commune(NEW.nom), 'commune');
  cand := base;
  IF EXISTS (SELECT 1 FROM public.communes_partenaires WHERE slug = cand AND id <> NEW.id) THEN
    cand := base || '-' || coalesce(nullif(btrim(NEW.code_postal),''), substr(NEW.id::text,1,6));
    IF EXISTS (SELECT 1 FROM public.communes_partenaires WHERE slug = cand AND id <> NEW.id) THEN
      cand := cand || '-' || substr(NEW.id::text,1,6);
    END IF;
  END IF;
  NEW.slug := cand;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_communes_partenaires_slug ON public.communes_partenaires;
CREATE TRIGGER trg_communes_partenaires_slug BEFORE INSERT OR UPDATE ON public.communes_partenaires
FOR EACH ROW EXECUTE FUNCTION public.communes_partenaires_set_slug();

-- Backfill: abonnés d'abord, pour qu'ils obtiennent le slug court
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.communes_partenaires WHERE slug IS NULL
           ORDER BY (commune_user_id IS NULL), created_at LOOP
    UPDATE public.communes_partenaires SET slug = NULL, nom = nom WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS communes_partenaires_slug_key ON public.communes_partenaires(slug);

ALTER TABLE public.statistiques_recherches ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.statistiques_recherches ADD COLUMN IF NOT EXISTS commune_slug text;
CREATE INDEX IF NOT EXISTS statistiques_recherches_slug_idx ON public.statistiques_recherches(commune_slug, created_at);

CREATE TABLE public.page_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_slug text NOT NULL,
  source text NOT NULL DEFAULT 'page',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.page_visits TO service_role;
ALTER TABLE public.page_visits ENABLE ROW LEVEL SECURITY;
CREATE INDEX page_visits_slug_idx ON public.page_visits(commune_slug, created_at);

CREATE OR REPLACE FUNCTION public.get_commune_page(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'slug', c.slug,
    'nom', coalesce(nullif(btrim(regexp_replace(p.nom_collectivite, '^(mairie|ville|commune)\s+(de\s+|d'')?', '', 'i')),''), c.nom),
    'code_postal', coalesce(nullif(btrim(p.code_postal),''), nullif(btrim(c.code_postal),'')),
    'logo_url', coalesce(p.logo_url, c.logo_url),
    'lien_action', coalesce(p.lien_action, c.lien_action),
    'pois', coalesce((SELECT jsonb_agg(jsonb_build_object('nom', x.nom, 'categorie', x.categorie, 'description', x.description) ORDER BY x.nom)
                      FROM public.commune_pois x WHERE x.commune_user_id = c.commune_user_id AND x.active), '[]'::jsonb)
  )
  FROM public.communes_partenaires c
  JOIN public.commune_profiles p ON p.user_id = c.commune_user_id
  WHERE c.slug = lower(p_slug) AND p.status_abonnement IN ('active','en_attente_mandat')
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.get_commune_page(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_legacy_commune(p_commune text, p_cp text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.slug FROM public.communes_partenaires c
  LEFT JOIN public.commune_profiles p ON p.user_id = c.commune_user_id
  WHERE c.slug = lower(p_commune)
     OR public.slugify_commune(c.nom) = public.slugify_commune(p_commune)
     OR lower(regexp_replace(translate(lower(coalesce(p.nom_collectivite, c.nom)),'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'),'[^a-z0-9]+','-','g')) = lower(p_commune)
  ORDER BY (c.commune_user_id IS NULL),
           (coalesce(p.code_postal, c.code_postal) IS DISTINCT FROM p_cp),
           (c.slug = lower(p_commune)) DESC
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.resolve_legacy_commune(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_commune_traffic(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_slug text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;
  SELECT slug INTO v_slug FROM public.communes_partenaires WHERE commune_user_id = auth.uid() LIMIT 1;
  IF v_slug IS NULL THEN RETURN jsonb_build_object('slug', NULL); END IF;
  RETURN jsonb_build_object(
    'slug', v_slug,
    'qr_scans', (SELECT count(*) FROM public.page_visits WHERE commune_slug = v_slug AND source = 'qr' AND created_at BETWEEN p_from AND p_to),
    'page_visits', (SELECT count(*) FROM public.page_visits WHERE commune_slug = v_slug AND created_at BETWEEN p_from AND p_to),
    'qr_balades', (SELECT count(*) FROM public.statistiques_recherches WHERE commune_slug = v_slug AND source = 'qr' AND created_at BETWEEN p_from AND p_to)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.get_my_commune_traffic(timestamptz, timestamptz) TO authenticated;