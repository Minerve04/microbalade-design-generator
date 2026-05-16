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
