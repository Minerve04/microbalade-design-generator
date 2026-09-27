CREATE TABLE IF NOT EXISTS public.balade_cache (
  cache_key text PRIMARY KEY,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.balade_cache TO service_role;
ALTER TABLE public.balade_cache ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.generation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  error text,
  duration_ms integer,
  cache_hit boolean NOT NULL DEFAULT false
);
GRANT ALL ON public.generation_requests TO service_role;
ALTER TABLE public.generation_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_generation_requests_ip_created ON public.generation_requests (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_requests_created ON public.generation_requests (created_at DESC);