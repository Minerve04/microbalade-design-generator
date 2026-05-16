INSERT INTO storage.buckets (id, name, public) VALUES ('commune-logos', 'commune-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read commune logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'commune-logos');