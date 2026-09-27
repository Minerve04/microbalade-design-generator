import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const slug = typeof body.slug === "string" ? body.slug.toLowerCase().trim() : "";
    const source = body.source === "qr" ? "qr" : "page";
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ error: "slug invalide" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: exists } = await admin.from("communes_partenaires").select("id").eq("slug", slug).maybeSingle();
    if (!exists) return json({ ok: false });
    const { error } = await admin.from("page_visits").insert({ commune_slug: slug, source });
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    console.error("log-visit", e);
    return json({ error: "Erreur" }, 500);
  }
});
