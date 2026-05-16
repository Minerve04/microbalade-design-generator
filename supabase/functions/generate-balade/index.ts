import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type BaladeStep = { title: string; description: string; place?: string };
type Waypoint = { coord: string; label: string };
type RouteMeasurement = { durationMinutes: number; distanceMeters: number };

// Google Maps walking pace ≈ 4.5 km/h ≈ 75 m/min ; we go slightly more conservative
// to absorb turns, traffic lights and snapping, so what we promise matches Google.
const EFFECTIVE_WALKING_SPEED_M_PER_MIN = 70;
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
  const durationMinutes = Math.ceil(distanceMeters / EFFECTIVE_WALKING_SPEED_M_PER_MIN);
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
  const buffer = duration >= 45 ? 5 : duration >= 30 ? 4 : 3;
  return Math.max(10, duration - buffer);
};

// We build candidate loops sized for the EFFECTIVE walking speed. The street network
// adds detours so the actual measured route will be longer than the geometric perimeter.
// We compensate with a conservative detour factor.
const createCandidateLoops = (originCoord: string, duration: number) => {
  const safeLimit = getSafeDurationLimit(duration);
  const targetWalkingMeters = safeLimit * EFFECTIVE_WALKING_SPEED_M_PER_MIN;
  // A 3-waypoint loop on streets ≈ ~6 * radius after street detours.
  // Reverse engineer: radius ≈ target / 6, with safety factor 0.85.
  const baseRadius = Math.max(60, Math.min(450, Math.round((targetWalkingMeters / 6) * 0.85)));
  const radii = Array.from(
    new Set([0.55, 0.7, 0.85, 1.0, 1.15].map((f) => Math.max(50, Math.round(baseRadius * f))))
  );
  const angleTemplates = [
    [15, 130, 255],
    [40, 160, 285],
    [70, 185, 320],
    [0, 120, 240],
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
  waypointLabels: string[],
  interests: string[],
  walkingMinutes: number
) => {
  const interestsHuman = interests
    .map((i) => INTEREST_LABELS[i] || i)
    .join(", ");
  const stepsList = waypointLabels
    .map((label, i) => `${i + 1}. ${label}`)
    .join("\n");
  return `Tu es un guide local francophone, expert du quartier et passionné. Tu produis des micro-anecdotes concrètes et sensorielles pour une balade à pied en boucle.

Départ : ${originLabel}
Durée mesurée : ${walkingMinutes} minutes à pied
Centres d'intérêt : ${interestsHuman}

Étapes (dans l'ordre) :
${stepsList}

Pour CHAQUE étape, écris exactement DEUX phrases :
- Phrase 1 : ce que le promeneur voit / observe à pied à cet endroit (détail concret, sensoriel, ancré dans le lieu).
- Phrase 2 : un fait court (anecdote, repère historique, ambiance, jeu de regard) qui donne envie de s'arrêter.

Pas d'introduction, pas de conclusion, pas de listes à puces, pas de titres. Réponds STRICTEMENT en JSON :
{"steps":[{"description":"..."},{"description":"..."},{"description":"..."}]}`;
};

const generateAiDescriptions = async (
  originLabel: string,
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
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: buildAiPrompt(originLabel, waypointLabels, interests, walkingMinutes),
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

    let bestWithinSafe: { coords: string[]; route: RouteMeasurement } | null = null;
    let bestWithinHard: { coords: string[]; route: RouteMeasurement } | null = null;

    for (const loop of loops) {
      try {
        const route = await getWalkingRoute([originResolved.coord, ...loop, originResolved.coord]);

        if (route.durationMinutes <= safeLimit) {
          if (!bestWithinSafe || route.durationMinutes > bestWithinSafe.route.durationMinutes) {
            bestWithinSafe = { coords: loop, route };
          }
        }
        if (route.durationMinutes <= duration) {
          if (!bestWithinHard || route.durationMinutes > bestWithinHard.route.durationMinutes) {
            bestWithinHard = { coords: loop, route };
          }
        }
      } catch {
        continue;
      }
    }

    const selected = bestWithinSafe || bestWithinHard;
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

    const [aiDescriptions, originDetails] = await Promise.all([
      generateAiDescriptions(
        originResolved.label,
        waypointLabels,
        interests as string[],
        selected.route.durationMinutes
      ),
      reverseGeocodeDetails(originResolved.coord),
    ]);

    return jsonResponse({
      steps: buildSteps(waypoints, aiDescriptions),
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
