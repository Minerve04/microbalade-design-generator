import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Tu es un guide local expert, concis et passionnant, spécialisé dans les lieux méconnus et insolites.
L'utilisateur va te fournir 3 informations : sa position de départ, le temps dont il dispose, et son centre d'intérêt.

Ta mission :
1. Dresse mentalement une liste exhaustive d'au moins 10 à 15 points d'intérêt ORIGINAUX, MÉCONNUS ou INSOLITES correspondant au thème dans la zone accessible à pied. Évite absolument les monuments et lieux touristiques classiques que tout le monde connaît. Privilégie : cours cachées, passages secrets, détails architecturaux oubliés, fresques discrètes, arbres remarquables, fontaines oubliées, plaques commémoratives insolites, impasses pittoresques, etc.
2. Parmi cette liste, TIRE AU SORT 3 points de manière aléatoire (utilise le nombre aléatoire suivant comme graine : ${Math.floor(Math.random() * 1000000)}). L'objectif est que deux utilisateurs partant du même endroit avec les mêmes critères obtiennent des parcours DIFFÉRENTS.
3. Organise ces 3 points en une boucle marchable depuis le point de départ. La boucle totale (départ -> point 1 -> point 2 -> point 3 -> retour au départ) ne doit absolument pas dépasser le temps indiqué à pied.

Pour chaque étape, rédige un titre accrocheur et exactement deux phrases d'anecdote historique, insolite ou culturelle. Sois percutant, pas de blabla.

Tu dois répondre UNIQUEMENT en JSON valide avec ce format exact, sans texte avant ni après :
{
  "steps": [
    { "title": "...", "description": "..." },
    { "title": "...", "description": "..." },
    { "title": "...", "description": "..." }
  ],
  "google_maps_url": "https://www.google.com/maps/dir/Point+de+départ/Point+1/Point+2/Point+3/Point+de+départ/?dirflg=w"
}

Remplace les espaces par des + dans l'URL Google Maps. Ne propose aucune introduction ni conclusion.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { location, duration, interests } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const interestLabels: Record<string, string> = {
      architecture: "Architecture",
      nature: "Nature",
      streetart: "Street-art",
      history: "Histoire insolite",
    };

    const interestText = (interests as string[])
      .map((i: string) => interestLabels[i] || i)
      .join(", ");

    const userPrompt = `Position de départ : ${location}\nTemps disponible : ${duration} minutes\nCentres d'intérêt : ${interestText}`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Trop de requêtes, réessayez dans un instant." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits IA épuisés." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content);
      throw new Error("Invalid AI response format");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-balade error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
