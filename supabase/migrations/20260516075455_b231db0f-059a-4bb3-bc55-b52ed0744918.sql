CREATE TABLE public.communes_partenaires (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nom TEXT NOT NULL,
  code_postal TEXT NOT NULL,
  logo_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_communes_partenaires_cp_active
  ON public.communes_partenaires (code_postal)
  WHERE active = true;

ALTER TABLE public.communes_partenaires ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Communes partenaires actives visibles par tous"
ON public.communes_partenaires
FOR SELECT
USING (active = true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_communes_partenaires_updated_at
BEFORE UPDATE ON public.communes_partenaires
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();