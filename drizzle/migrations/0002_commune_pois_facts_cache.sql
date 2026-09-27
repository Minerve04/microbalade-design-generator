CREATE TABLE public.commune_pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_postal text NOT NULL,
  nom text NOT NULL CHECK (char_length(nom) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 800),
  categorie text NOT NULL DEFAULT 'patrimoine' CHECK (categorie IN ('patrimoine','nature','street_art','commerce','autre')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  url_source text CHECK (url_source IS NULL OR url_source ~* '^https?://'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commune_pois TO authenticated;
GRANT ALL ON public.commune_pois TO service_role;
ALTER TABLE public.commune_pois ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_commune_pois_cp ON public.commune_pois (code_postal) WHERE active;

CREATE OR REPLACE FUNCTION public.commune_is_subscribed(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.commune_profiles WHERE user_id = _uid AND status_abonnement IN ('active','en_attente_mandat'))
$$;

CREATE POLICY "Commune gere ses lieux" ON public.commune_pois FOR ALL TO authenticated
USING (commune_user_id = auth.uid() AND public.commune_is_subscribed(auth.uid()))
WITH CHECK (commune_user_id = auth.uid() AND public.commune_is_subscribed(auth.uid()));

CREATE TRIGGER commune_pois_updated_at BEFORE UPDATE ON public.commune_pois
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.facts_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.facts_cache TO service_role;
ALTER TABLE public.facts_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.generation_requests
  ADD COLUMN unsourced_count integer,
  ADD COLUMN ai_retried boolean;

DELETE FROM public.balade_cache;