CREATE TABLE public.pilot_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_nom text NOT NULL,
  code_postal text,
  population integer,
  contact_nom text NOT NULL,
  fonction text NOT NULL,
  email text NOT NULL,
  telephone text,
  message text,
  status text NOT NULL DEFAULT 'nouveau' CHECK (status IN ('nouveau','contacte','pilote_actif','refuse')),
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pilot_requests TO service_role;
ALTER TABLE public.pilot_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX pilot_requests_ip_created_idx ON public.pilot_requests (ip, created_at);

CREATE OR REPLACE FUNCTION public.expire_pilots()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.bypass_billing_guard', 'on', true);
  UPDATE public.commune_profiles
     SET status_abonnement = 'incomplete'
   WHERE abonnement_label = 'Pilote gratuit 3 mois'
     AND abonnement_prix_annuel = 0
     AND status_abonnement = 'active'
     AND abonnement_renouvellement < current_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.bypass_billing_guard', 'off', true);
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.expire_pilots() FROM PUBLIC, anon, authenticated;