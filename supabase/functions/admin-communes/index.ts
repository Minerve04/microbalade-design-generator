import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { password, action, payload } = await req.json();
    const adminPwd = Deno.env.get("ADMIN_PASSWORD");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim() || "unknown";
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("admin_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) {
      return json({ error: "Trop de tentatives, réessayez dans 15 minutes" }, 429);
    }

    if (!adminPwd || typeof password !== "string" || !(await timingSafeEqual(password, adminPwd))) {
      await supabase.from("admin_login_attempts").insert({ ip });
      return json({ error: "Unauthorized" }, 401);
    }

    if (action === "list") {
      const { data, error } = await supabase
        .from("communes_partenaires")
        .select("*")
        .order("nom", { ascending: true });
      if (error) throw error;
      return json({ data });
    }

    if (action === "create") {
      const { nom, code_postal, logo_url, active, lien_action } = payload ?? {};
      if (!nom || !code_postal) return json({ error: "nom et code_postal requis" }, 400);
      if (lien_action && !isHttpUrl(lien_action)) return json({ error: "lien_action invalide (http/https)" }, 400);
      const { data, error } = await supabase
        .from("communes_partenaires")
        .insert({ nom, code_postal, logo_url: logo_url || null, lien_action: lien_action || null, active: active ?? true })
        .select()
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "update") {
      const { id, ...raw } = payload ?? {};
      if (!id) return json({ error: "id requis" }, 400);
      const ALLOWED = ["nom", "code_postal", "logo_url", "lien_action", "active"];
      const fields: Record<string, unknown> = {};
      for (const k of ALLOWED) if (k in raw) fields[k] = raw[k];
      if (fields.lien_action && !isHttpUrl(String(fields.lien_action))) {
        return json({ error: "lien_action invalide (http/https)" }, 400);
      }
      if (fields.lien_action === "") fields.lien_action = null;
      const { data, error } = await supabase
        .from("communes_partenaires")
        .update(fields)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "delete") {
      const { id } = payload ?? {};
      if (!id) return json({ error: "id requis" }, 400);
      const { error } = await supabase.from("communes_partenaires").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "upload_logo") {
      const { filename, content_type, data_base64 } = payload ?? {};
      if (!filename || !data_base64) return json({ error: "filename et data_base64 requis" }, 400);
      const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
      if (content_type && !allowed.includes(content_type)) {
        return json({ error: "Format d'image non supporté" }, 400);
      }
      const bytes = Uint8Array.from(atob(data_base64), (c) => c.charCodeAt(0));
      if (bytes.length > 2 * 1024 * 1024) {
        return json({ error: "Image trop volumineuse (max 2 Mo)" }, 400);
      }
      const ext = (filename.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("commune-logos")
        .upload(path, bytes, { contentType: content_type || "application/octet-stream", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("commune-logos").getPublicUrl(path);
      return json({ url: pub.publicUrl });
    }

    if (action === "list_stats") {
      const { code_postal, ville, from, to } = payload ?? {};
      let q = supabase
        .from("statistiques_recherches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (code_postal) q = q.eq("code_postal", code_postal);
      if (ville) q = q.ilike("ville", `%${ville}%`);
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to);
      const { data, error } = await q;
      if (error) throw error;
      return json({ data });
    }

    if (action === "health") {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("generation_requests")
        .select("status,cache_hit,duration_ms")
        .gte("created_at", since)
        .limit(50000);
      if (error) throw error;
      const rows = data ?? [];
      const ok = rows.filter((r) => r.status === "success");
      const failed = rows.filter((r) => r.status === "error").length;
      const cacheHits = ok.filter((r) => r.cache_hit).length;
      const durations = ok.map((r) => r.duration_ms ?? 0).sort((a, b) => a - b);
      const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
      return json({
        data: {
          success: ok.length,
          failed,
          cache_rate: ok.length ? cacheHits / ok.length : 0,
          median_ms: median,
        },
      });
    }

    if (action === "list_chorus") {
      const { status } = payload ?? {};
      let q = supabase
        .from("commune_profiles")
        .select(
          "id,user_id,nom_collectivite,email,code_postal,siret,numero_engagement,code_service_chorus,adresse_facturation,email_comptabilite,abonnement_label,abonnement_prix_annuel,status_abonnement,chorus_status,chorus_requested_at,chorus_paid_at,chorus_due_date,mode_paiement"
        )
        .eq("mode_paiement", "chorus")
        .order("chorus_requested_at", { ascending: false });
      if (status && status !== "all") q = q.eq("chorus_status", status);
      const { data, error } = await q;
      if (error) throw error;
      return json({ data });
    }

    if (action === "mark_chorus_paid") {
      const { user_id } = payload ?? {};
      if (!user_id) return json({ error: "user_id requis" }, 400);
      const now = new Date();
      const renouv = new Date(now);
      renouv.setFullYear(renouv.getFullYear() + 1);
      const { data, error } = await supabase
        .from("commune_profiles")
        .update({
          status_abonnement: "active",
          chorus_status: "paid",
          chorus_paid_at: now.toISOString(),
          abonnement_renouvellement: renouv.toISOString().slice(0, 10),
        })
        .eq("user_id", user_id)
        .select()
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "mark_chorus_overdue") {
      const { user_id } = payload ?? {};
      if (!user_id) return json({ error: "user_id requis" }, 400);
      const { data, error } = await supabase
        .from("commune_profiles")
        .update({ chorus_status: "overdue" })
        .eq("user_id", user_id)
        .select()
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "cancel_chorus") {
      const { user_id } = payload ?? {};
      if (!user_id) return json({ error: "user_id requis" }, 400);
      const { error } = await supabase
        .from("commune_profiles")
        .update({
          status_abonnement: "canceled",
          chorus_status: "cancelled",
          mode_paiement: "stripe",
        })
        .eq("user_id", user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
