import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";
const KEYS = ["commune_village_year","commune_petite_ville_year","commune_ville_moyenne_year","commune_grande_ville_year","commune_metropole_year","commune_metropole_xl_year"];
Deno.serve(async () => {
  const out: Record<string, unknown> = {};
  for (const env of ["sandbox", "live"] as StripeEnv[]) {
    try {
      const s = createStripeClient(env);
      const p = await s.prices.list({ lookup_keys: KEYS, limit: 20 });
      out[env] = p.data.map((x) => ({ k: x.lookup_key, amt: x.unit_amount, cur: x.currency, int: x.recurring?.interval, n: x.recurring?.interval_count, active: x.active }));
    } catch (e) { out[env] = String(e); }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
