CREATE POLICY "Commune voit stats de son code postal"
ON public.statistiques_recherches
FOR SELECT
TO authenticated
USING (
  code_postal IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.commune_profiles cp
    WHERE cp.user_id = auth.uid()
      AND cp.code_postal = statistiques_recherches.code_postal
  )
);

CREATE POLICY "Admins voient toutes les stats"
ON public.statistiques_recherches
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Public peut insérer des stats"
ON public.statistiques_recherches
FOR INSERT
TO anon, authenticated
WITH CHECK (true);