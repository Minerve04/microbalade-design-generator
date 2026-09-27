-- Les fiches partenaires des communes abonnées étaient invisibles pour le public :
-- la politique consultait commune_profiles, elle-même protégée par RLS (anon ne voit rien).
-- Appliqué directement en base le 27/09/2026 ; ce fichier le rend reproductible (idempotent).
CREATE OR REPLACE FUNCTION public.is_commune_subscribed(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.commune_profiles cp WHERE cp.user_id = _user_id AND cp.status_abonnement IN ('active','en_attente_mandat'))
$$;
GRANT EXECUTE ON FUNCTION public.is_commune_subscribed(uuid) TO anon, authenticated;
DROP POLICY IF EXISTS "Logos partenaires visibles si actifs ou abonnes" ON public.communes_partenaires;
CREATE POLICY "Logos partenaires visibles si actifs ou abonnes" ON public.communes_partenaires
FOR SELECT TO public USING (active = true AND (commune_user_id IS NULL OR public.is_commune_subscribed(commune_user_id)));
