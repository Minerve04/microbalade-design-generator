import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const logSearchStat = async (row: {
  ville: string | null;
  code_postal: string | null;
  duree_minutes: number;
  themes: string[];
  monuments: string[];
  origin_address: string | null;
}) => {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const client = createClient(url, key);
    const { error } = await client.from("statistiques_recherches").insert(row);
    if (error) console.error("stats insert error:", error.message);
  } catch (e) {
    console.error("stats insert exception:", e);
  }
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type BaladeStep = { title: string; description: string; place?: string };
type Waypoint = { coord: string; label: string };
type RouteMeasurement = { durationMinutes: number; distanceMeters: number };

// Google Maps walking pace ≈ 5 km/h ≈ 83 m/min. We align on Google's pace so that
// what we promise matches what the user sees in Google Maps.
const EFFECTIVE_WALKING_SPEED_M_PER_MIN = 83;
const ORIGIN_SEARCH_TIMEOUT_MS = 3500;
const REVERSE_GEOCODE_TIMEOUT_MS = 1800;
const ROUTE_TIMEOUT_MS = 5000;
const AI_TIMEOUT_MS = 9000;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const businessError = (message: string) => jsonResponse({ error: message }, 200);

const fetchWithTimeout = (input: string, init: RequestInit = {}, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
};

const parseCoord = (coord: string) => {
  const [lon, lat] = coord.split(",").map(Number);
  return { lon, lat };
};

const formatCoord = (lon: number, lat: number) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

const toLatLng = (coord: string) => {
  const { lon, lat } = parseCoord(coord);
  return `${lat},${lon}`;
};

const geocode = async (query: string, context?: string) => {
  const candidates = [query, context ? `${query}, ${context}` : null].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=fr&q=${encodeURIComponent(candidate)}`,
        { headers: { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" } },
        ORIGIN_SEARCH_TIMEOUT_MS
      );
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
        return {
          coord: formatCoord(Number(data[0].lon), Number(data[0].lat)),
          label: data[0]?.display_name || candidate,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
};

const reverseGeocode = async (coord: string, fallbackLabel: string) => {
  try {
    const { lat, lon } = parseCoord(coord);
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr`,
      { headers: { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" } },
      REVERSE_GEOCODE_TIMEOUT_MS
    );
    if (!response.ok) return fallbackLabel;
    const data = await response.json();
    const address = data?.address || {};
    const name = address.road || address.pedestrian || address.footway || address.neighbourhood || address.suburb;
    const locality = address.city || address.town || address.village || address.municipality;
    const label = [name, locality].filter(Boolean).join(", ");
    return label || data?.display_name || fallbackLabel;
  } catch {
    return fallbackLabel;
  }
};

const reverseGeocodeDetails = async (coord: string): Promise<{ postcode?: string; city?: string }> => {
  try {
    const { lat, lon } = parseCoord(coord);
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr&addressdetails=1`,
      { headers: { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" } },
      REVERSE_GEOCODE_TIMEOUT_MS
    );
    if (!response.ok) return {};
    const data = await response.json();
    const address = data?.address || {};
    return {
      postcode: address.postcode || undefined,
      city: address.city || address.town || address.village || address.municipality || undefined,
    };
  } catch {
    return {};
  }
};

// Measure real walking route via OSRM (foot profile). We trust the DISTANCE, not the
// duration: the OSRM demo's foot speed is optimistic vs Google Maps. We recompute
// the time from the distance with a Google-equivalent pace so the promised duration
// matches what the user will actually see in Google Maps.
const getWalkingRoute = async (coordinates: string[]): Promise<RouteMeasurement> => {
  const url = `https://router.project-osrm.org/route/v1/foot/${coordinates.join(";")}?overview=false&steps=false`;
  const response = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" } },
    ROUTE_TIMEOUT_MS
  );
  if (!response.ok) throw new Error("OSRM unreachable");
  const data = await response.json();
  const route = data?.routes?.[0];
  if (!route || typeof route.distance !== "number") throw new Error("No route");

  const distanceMeters = Math.round(route.distance);
  const durationMinutes = Math.round(distanceMeters / EFFECTIVE_WALKING_SPEED_M_PER_MIN);
  return { durationMinutes, distanceMeters };
};

const offsetCoordinate = (coord: string, distanceMeters: number, bearingDegrees: number) => {
  const { lon, lat } = parseCoord(coord);
  const earthRadius = 6371000;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const angularDistance = distanceMeters / earthRadius;
  const nextLat = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const nextLon =
    lonRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(nextLat)
    );
  return formatCoord((nextLon * 180) / Math.PI, (nextLat * 180) / Math.PI);
};

const getSafeDurationLimit = (duration: number) => {
  // Tight buffer: we want the loop to be as close as possible to the requested duration.
  const buffer = duration >= 60 ? 2 : 1;
  return Math.max(10, duration - buffer);
};

// Minimum acceptable duration: we refuse loops that are way under target (e.g. half).
const getMinAcceptableDuration = (duration: number) => Math.max(10, Math.floor(duration * 0.85));

// Build a wide pool of candidate loops sized for the EFFECTIVE walking speed.
// We over-sample (more angles, more radii, including tiny emergency loops) so that
// dense city centers with canals, one-way streets or river crossings still yield
// at least one candidate whose measured OSRM walking time fits the budget.
const createCandidateLoops = (originCoord: string, duration: number) => {
  const safeLimit = getSafeDurationLimit(duration);
  const targetWalkingMeters = safeLimit * EFFECTIVE_WALKING_SPEED_M_PER_MIN;
  // 3-waypoint loop perimeter ≈ ~7 * radius after street detours.
  const baseRadius = Math.max(60, Math.min(500, Math.round(targetWalkingMeters / 7)));
  // Favor radii near and slightly above target so we can hit the requested duration precisely.
  const radiusFactors = [0.85, 0.95, 1.0, 1.05, 1.15, 1.25, 0.7];
  const dynamicRadii = radiusFactors.map((f) => Math.max(50, Math.round(baseRadius * f)));
  // Emergency tiny loops kept as a last-resort fallback only.
  const emergencyRadii = [120, 180];
  const radii = Array.from(new Set([...dynamicRadii, ...emergencyRadii]));

  const angleTemplates = [
    [0, 120, 240],
    [15, 130, 255],
    [40, 160, 285],
    [70, 185, 320],
    [30, 150, 270],
    [60, 180, 300],
    [90, 210, 330],
    [45, 165, 285],
  ];
  return radii.flatMap((radius) =>
    angleTemplates.map((angles) => angles.map((angle) => offsetCoordinate(originCoord, radius, angle)))
  );
};

const buildGoogleMapsUrl = (origin: string, waypoints: string[]) => {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("travelmode", "walking");
  url.searchParams.set("dir_action", "navigate");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", origin);
  url.searchParams.set("waypoints", waypoints.join("|"));
  return url.toString();
};

const FALLBACK_DESCRIPTIONS = [
  "Premier détour : ouvrez l'œil sur ce que la marche révèle dans les premières rues, là où la voiture n'aurait rien laissé voir. Laissez la cadence ralentir pour entrer dans le rythme de la balade.",
  "Point de passage : ce pivot relie deux ambiances du quartier et offre un vrai temps d'observation. Profitez-en pour repérer un détail que vous n'auriez jamais remarqué autrement.",
  "Retour par la boucle : la dernière portion vous ramène doucement vers le départ par un autre angle. Gardez les yeux levés, c'est souvent là que se cachent les meilleures surprises.",
];

const INTEREST_LABELS: Record<string, string> = {
  nature: "nature urbaine, jardins et arbres remarquables",
  architecture: "architecture, façades et détails bâtis",
  streetart: "street art, fresques et signes graphiques",
  history: "histoire, traces du passé et patrimoine discret",
};

const buildAiPrompt = (
  originLabel: string,
  city: string | undefined,
  waypointLabels: string[],
  interests: string[],
  walkingMinutes: number
) => {
  const interestsHuman = interests.map((i) => INTEREST_LABELS[i] || i).join(", ");
  const stepsList = waypointLabels.map((label, i) => `${i + 1}. ${label}`).join("\n");
  const cityLine = city ? `Ville : ${city}\n` : "";
  return `Tu es un guide local francophone, expert du quartier où se déroule la balade. Tu connais ${city || "cette ville"} dans le détail : son histoire, ses rues, ses commerces, son architecture, ses anecdotes. Tu écris pour quelqu'un qui marche RÉELLEMENT à cet endroit, là, maintenant.

Départ : ${originLabel}
${cityLine}Durée mesurée : ${walkingMinutes} minutes à pied
Centres d'intérêt du promeneur : ${interestsHuman}

Étapes de la boucle (dans l'ordre, noms de rues/lieux RÉELS extraits de l'itinéraire) :
${stepsList}

Pour CHAQUE étape, écris exactement DEUX phrases, en français, ANCRÉES dans le lieu nommé ci-dessus :
- Phrase 1 : décris concrètement ce qu'on voit dans CETTE rue ou à CET endroit précis (nom de la rue/lieu intégré naturellement, détail visuel/sonore/olfactif tangible, élément d'architecture, commerce typique, perspective, matériau...). Pas de généralités passe-partout.
- Phrase 2 : une vraie information liée à cet endroit ou au quartier (anecdote historique, origine du nom, fait local, usage actuel, particularité du bâti, lien avec un personnage ou un événement de ${city || "la ville"}). Si tu ne connais pas un fait précis et vérifié, donne plutôt une observation fine et crédible propre à ce type de rue dans ${city || "cette ville"} — JAMAIS de tournure générique du type "ouvrez l'œil", "laissez le rythme", "ce pivot relie deux ambiances".

Règles strictes :
- Cite le nom exact de la rue ou du lieu fourni dans la phrase 1.
- Pas d'introduction, pas de conclusion, pas de liste à puces, pas de titre, pas d'emoji.
- Pas de phrases creuses, pas de tutoiement injonctif vague, pas de répétitions entre les étapes.
- Réponds STRICTEMENT en JSON :
{"steps":[{"description":"..."},{"description":"..."},{"description":"..."}]}`;
};

const generateAiDescriptions = async (
  originLabel: string,
  city: string | undefined,
  waypointLabels: string[],
  interests: string[],
  walkingMinutes: number
): Promise<string[] | null> => {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;

  try {
    const response = await fetchWithTimeout(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            {
              role: "user",
              content: buildAiPrompt(originLabel, city, waypointLabels, interests, walkingMinutes),
            },
          ],
          response_format: { type: "json_object" },
        }),
      },
      AI_TIMEOUT_MS
    );

    if (!response.ok) {
      console.warn("AI gateway non-2xx", response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : null;
    if (!steps) return null;

    return steps
      .map((s: any) => (typeof s?.description === "string" ? s.description.trim() : ""))
      .filter(Boolean);
  } catch (e) {
    console.warn("AI generation failed:", e);
    return null;
  }
};

const buildSteps = (
  waypoints: Waypoint[],
  aiDescriptions: string[] | null
): BaladeStep[] => {
  const titles = ["Premier détour", "Point de passage", "Retour par la boucle"];
  return waypoints.map((waypoint, index) => ({
    title: titles[index] ?? `Étape ${index + 1}`,
    description:
      aiDescriptions?.[index] ||
      FALLBACK_DESCRIPTIONS[index] ||
      FALLBACK_DESCRIPTIONS[FALLBACK_DESCRIPTIONS.length - 1],
    place: waypoint.label,
  }));
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { location, duration, interests } = await req.json();

    if (!location || typeof location !== "string") {
      return businessError("Veuillez indiquer un point de départ valide.");
    }
    if (!Number.isFinite(duration) || duration < 15 || duration > 120) {
      return businessError("Le temps disponible doit être compris entre 15 et 120 minutes.");
    }
    if (!Array.isArray(interests) || interests.length === 0) {
      return businessError("Choisissez au moins un centre d'intérêt.");
    }

    const routeContext = location.includes(",") ? location.split(",").slice(-3).join(",").trim() : location;
    const originResolved = await geocode(location, routeContext);
    if (!originResolved) {
      return businessError("Impossible de localiser précisément le point de départ.");
    }

    const safeLimit = getSafeDurationLimit(duration);
    const loops = createCandidateLoops(originResolved.coord, duration);

    const minAcceptable = getMinAcceptableDuration(duration);

    // Pick the candidate whose measured duration is CLOSEST to the requested duration
    // (without exceeding it). We evaluate ALL candidates — no early exit — so a tiny
    // 15-min loop never wins over a true 29-min loop for a 30-min request.
    let bestCloseToTarget: { coords: string[]; route: RouteMeasurement } | null = null;
    let bestWithinHard: { coords: string[]; route: RouteMeasurement } | null = null;

    const CHUNK = 8;
    for (let i = 0; i < loops.length; i += CHUNK) {
      const chunk = loops.slice(i, i + CHUNK);
      const results = await Promise.allSettled(
        chunk.map((loop) =>
          getWalkingRoute([originResolved.coord, ...loop, originResolved.coord]).then(
            (route) => ({ loop, route })
          )
        )
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { loop, route } = r.value;
        if (route.durationMinutes <= duration) {
          if (!bestWithinHard || route.durationMinutes > bestWithinHard.route.durationMinutes) {
            bestWithinHard = { coords: loop, route };
          }
          if (route.durationMinutes >= minAcceptable) {
            if (!bestCloseToTarget || route.durationMinutes > bestCloseToTarget.route.durationMinutes) {
              bestCloseToTarget = { coords: loop, route };
            }
          }
        }
      }
    }

    const selected = bestCloseToTarget || bestWithinHard;
    if (!selected) {
      return businessError(
        `Impossible de garantir un trajet Google Maps à pied dans ${duration} minutes maximum depuis cette adresse. Essayez une adresse plus centrale ou un temps plus long.`
      );
    }

    const waypointLabels = await Promise.all(
      selected.coords.map((coord, index) => reverseGeocode(coord, `Point de balade ${index + 1}`))
    );

    const waypoints: Waypoint[] = selected.coords.map((coord, index) => ({
      coord,
      label: waypointLabels[index],
    }));

    // Resolve city FIRST so the AI prompt can be anchored to it.
    const originDetails = await reverseGeocodeDetails(originResolved.coord);
    const aiDescriptions = await generateAiDescriptions(
      originResolved.label,
      originDetails.city,
      waypointLabels,
      interests as string[],
      selected.route.durationMinutes
    );

    const steps = buildSteps(waypoints, aiDescriptions);

    // Fire-and-forget logging of the successful search
    logSearchStat({
      ville: originDetails.city ?? null,
      code_postal: originDetails.postcode ?? null,
      duree_minutes: duration,
      themes: interests as string[],
      monuments: waypointLabels,
      origin_address: originResolved.label ?? location,
    });

    return jsonResponse({
      steps,
      google_maps_url: buildGoogleMapsUrl(
        toLatLng(originResolved.coord),
        waypoints.map((p) => toLatLng(p.coord))
      ),
      walking_minutes: selected.route.durationMinutes,
      walking_distance_meters: selected.route.distanceMeters,
      origin_postcode: originDetails.postcode ?? null,
      origin_city: originDetails.city ?? null,
    });
  } catch (e) {
    console.error("generate-balade error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
