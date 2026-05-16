REVOKE ALL ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sync_commune_partner_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_commune_partner_active() TO service_role;