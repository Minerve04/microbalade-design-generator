CREATE TABLE public.statistiques_recherches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ville TEXT,
  code_postal TEXT,
  duree_minutes INTEGER,
  themes TEXT[],
  monuments TEXT[],
  origin_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.statistiques_recherches ENABLE ROW LEVEL SECURITY;

-- No public policies: only service role (edge functions) can read/write.
CREATE INDEX idx_stats_created_at ON public.statistiques_recherches(created_at DESC);
CREATE INDEX idx_stats_code_postal ON public.statistiques_recherches(code_postal);