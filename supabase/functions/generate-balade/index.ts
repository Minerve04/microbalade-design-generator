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
4. Mode de déplacement autorisé : marche uniquement. N'envisage jamais voiture, taxi, vélo, trottinette ou transports en commun.

Pour chaque étape, rédige un titre accrocheur et exactement deux phrases d'anecdote historique, insolite ou culturelle. Sois percutant, pas de blabla.

Tu dois répondre UNIQUEMENT en JSON valide avec ce format exact, sans texte avant ni après :
{
  "steps": [
    { "title": "...", "description": "...", "place": "Nom précis du lieu + ville" },
    { "title": "...", "description": "...", "place": "Nom précis du lieu + ville" },
    { "title": "...", "description": "...", "place": "Nom précis du lieu + ville" }
  ]
}

Le champ "place" doit être une adresse ou un nom de lieu suffisamment précis pour être trouvé sur Google Maps (ex: "Cour de l'Hôtel Sandelin, Saint-Omer"). Ne propose aucune introduction ni conclusion.`;

type BaladeStep = { title: string; description: string; place?: string };

const MAX_GENERATION_ATTEMPTS = 4;

const geocode = async (q: string, context?: string): Promise<{ coord: string; label: string } | null> => {
  const candidates = [q, context ? `${q}, ${context}` : null].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=fr&q=${encodeURIComponent(candidate)}`,
        { headers: { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j) && j[0]?.lat && j[0]?.lon) {
        return {
          coord: `${j[0].lon},${j[0].lat}`,
          label: j[0]?.display_name || candidate,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
};

const getWalkingRoute = async (coordinates: string[]) => {
  const routeUrl = `https://router.project-osrm.org/route/v1/foot/${coordinates.join(";")}?overview=false&steps=false`;
  const response = await fetch(routeUrl, {
    headers: { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" },
  });

  if (!response.ok) {
    throw new Error("Impossible de calculer un itinéraire piéton fiable.");
  }

  const data = await response.json();
  const route = data?.routes?.[0];

  if (!route?.duration || !Array.isArray(route.legs) || route.legs.length === 0) {
    throw new Error("Aucun itinéraire piéton exploitable n'a été trouvé.");
  }

  return {
    durationMinutes: Math.ceil(route.duration / 60),
    distanceMeters: route.distance ?? 0,
  };
};

const buildGoogleMapsUrl = (origin: string, waypoints: string[]) => {
  const googleMapsUrl = new URL("https://www.google.com/maps/dir/");
  googleMapsUrl.searchParams.set("api", "1");
  googleMapsUrl.searchParams.set("travelmode", "walking");
  googleMapsUrl.searchParams.set("dir_action", "navigate");
  googleMapsUrl.searchParams.set("origin", origin);
  googleMapsUrl.searchParams.set("destination", origin);
  googleMapsUrl.searchParams.set("waypoints", waypoints.join("|"));
  return googleMapsUrl.toString();
};

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

    const routeContext = location.includes(",")
      ? location.split(",").slice(-3).join(",").trim()
      : location;

    const originResolved = await geocode(location);
    if (!originResolved) {
      return new Response(
        JSON.stringify({ error: "Impossible de localiser précisément le point de départ." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let finalSteps: BaladeStep[] | null = null;
    let finalGoogleMapsUrl: string | null = null;

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const userPrompt = [
        `Position de départ : ${location}`,
        `Temps disponible : ${duration} minutes`,
        `Centres d'intérêt : ${interestText}`,
        attempt > 0
          ? `IMPORTANT : ta précédente proposition dépassait le temps demandé à pied. Réduis fortement le rayon pour garantir une boucle totale de ${duration} minutes maximum à pied.`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

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

      let parsed: { steps: BaladeStep[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        console.error("Failed to parse AI response:", content);
        throw new Error("Invalid AI response format");
      }

      const steps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, 3) : [];
      if (steps.length !== 3) {
        continue;
      }

      const resolvedWaypoints = await Promise.all(
        steps.map(async (step) => geocode(step.place || step.title, routeContext))
      );

      if (resolvedWaypoints.some((point) => !point)) {
        continue;
      }

      const waypointPoints = resolvedWaypoints.filter(Boolean) as Array<{ coord: string; label: string }>;

      const walkingRoute = await getWalkingRoute([
        originResolved.coord,
        ...waypointPoints.map((point) => point.coord),
        originResolved.coord,
      ]);

      if (walkingRoute.durationMinutes <= duration) {
        finalSteps = steps;
        finalGoogleMapsUrl = buildGoogleMapsUrl(
          originResolved.coord.split(",").reverse().join(","),
          waypointPoints.map((point) => point.coord.split(",").reverse().join(","))
        );
        break;
      }
    }

    if (!finalSteps || !finalGoogleMapsUrl) {
      return new Response(
        JSON.stringify({ error: `Impossible de garantir une boucle à pied de ${duration} minutes maximum depuis cette adresse. Essayez un temps plus long ou une adresse plus centrale.` }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ steps: finalSteps, google_maps_url: finalGoogleMapsUrl }), {
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
