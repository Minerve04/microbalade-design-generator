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
    if (!adminPwd || password !== adminPwd) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "list") {
      const { data, error } = await supabase
        .from("communes_partenaires")
        .select("*")
        .order("nom", { ascending: true });
      if (error) throw error;
      return json({ data });
    }

    if (action === "create") {
      const { nom, code_postal, logo_url, active } = payload ?? {};
      if (!nom || !code_postal) return json({ error: "nom et code_postal requis" }, 400);
      const { data, error } = await supabase
        .from("communes_partenaires")
        .insert({ nom, code_postal, logo_url: logo_url || null, active: active ?? true })
        .select()
        .single();
      if (error) throw error;
      return json({ data });
    }

    if (action === "update") {
      const { id, ...fields } = payload ?? {};
      if (!id) return json({ error: "id requis" }, 400);
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
