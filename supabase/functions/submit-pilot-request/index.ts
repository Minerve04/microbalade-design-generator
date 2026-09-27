import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const FONCTIONS = [
  "Élu(e)",
  "DGS",
  "Office de tourisme",
  "Chef de projet Petites Villes de Demain / Action Cœur de Ville",
  "Autre",
] as const;

const Body = z.object({
  commune_nom: z.string().trim().min(1).max(120),
  code_postal: z.string().trim().regex(/^\d{5}$/).optional().nullable(),
  population: z.number().int().min(0).max(5_000_000).optional().nullable(),
  contact_nom: z.string().trim().min(1).max(120),
  fonction: z.enum(FONCTIONS),
  email: z.string().trim().email().max(200),
  telephone: z.string().trim().max(30).optional().nullable(),
  message: z.string().trim().max(3000).optional().nullable(),
  rgpd: z.literal(true),
  website: z.string().optional(), // honeypot
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return json({ error: "Formulaire incomplet ou invalide", details: parsed.error.flatten().fieldErrors }, 400);
    const d = parsed.data;
    // Honeypot filled → pretend success, store nothing
    if (d.website && d.website.trim() !== "") return json({ ok: true });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim() || "unknown";
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("pilot_requests").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Trop de demandes, réessayez dans une heure." }, 429);

    const row = {
      commune_nom: d.commune_nom,
      code_postal: d.code_postal || null,
      population: d.population ?? null,
      contact_nom: d.contact_nom,
      fonction: d.fonction,
      email: d.email.toLowerCase(),
      telephone: d.telephone || null,
      message: d.message || null,
      ip,
    };
    const { data: inserted, error } = await admin.from("pilot_requests").insert(row).select("id").single();
    if (error) throw error;

    const { ip: _ip, ...mailData } = row;
    const r1 = await admin.functions.invoke("send-transactional-email", {
      body: {
        templateName: "pilot-notification",
        recipientEmail: "contact@microbalade.com",
        idempotencyKey: `pilot-notify-${inserted.id}`,
        templateData: mailData,
      },
    });
    if (r1.error) console.error("pilot-notification", r1.error);
    const r2 = await admin.functions.invoke("send-transactional-email", {
      body: {
        templateName: "pilot-confirmation",
        recipientEmail: row.email,
        idempotencyKey: `pilot-confirm-${inserted.id}`,
        templateData: { name: row.contact_nom, commune: row.commune_nom },
      },
    });
    if (r2.error) console.error("pilot-confirmation", r2.error);

    return json({ ok: true });
  } catch (e) {
    console.error("submit-pilot-request", e);
    return json({ error: "Erreur, réessayez plus tard." }, 500);
  }
});
