
-- Table de profil pour les communes partenaires
CREATE TABLE public.commune_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  email TEXT NOT NULL,
  nom_collectivite TEXT NOT NULL,
  code_postal TEXT,
  logo_url TEXT,
  lien_action TEXT,
  abonnement_label TEXT NOT NULL DEFAULT 'Abonnement Petite Ville',
  abonnement_prix_annuel INTEGER NOT NULL DEFAULT 600,
  abonnement_renouvellement DATE NOT NULL DEFAULT (now() + interval '1 year')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.commune_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Une commune voit son profil"
ON public.commune_profiles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Une commune modifie son profil"
ON public.commune_profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Une commune insère son profil"
ON public.commune_profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_commune_profiles_updated_at
BEFORE UPDATE ON public.commune_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Création automatique du profil à l'inscription
CREATE OR REPLACE FUNCTION public.handle_new_commune_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.commune_profiles (user_id, email, nom_collectivite)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nom_collectivite', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_commune
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_commune_user();

-- Politiques storage pour le bucket commune-logos (déjà public en lecture)
CREATE POLICY "Communes uploadent leur logo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'commune-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Communes mettent à jour leur logo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'commune-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Communes suppriment leur logo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'commune-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
