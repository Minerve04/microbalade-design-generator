import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Tu es un guide local expert, concis et passionnant, spécialisé dans les lieux méconnus et insolites.

L'utilisateur te donnera un point de départ, un temps disponible et exactement 3 lieux déjà choisis dans le bon ordre.
Ta mission : écrire pour chacun de ces 3 lieux un titre accrocheur et exactement deux phrases d'anecdote historique, insolite ou culturelle.

Contraintes absolues :
- Ne change jamais l'ordre des lieux.
- Ne change jamais le nom des lieux.
- N'ajoute aucune introduction ni conclusion.
- Réponds uniquement en JSON valide.

Format attendu :
{
  "steps": [
    { "title": "...", "description": "...", "place": "Nom exact du lieu 1" },
    { "title": "...", "description": "...", "place": "Nom exact du lieu 2" },
    { "title": "...", "description": "...", "place": "Nom exact du lieu 3" }
  ]
}`;

type BaladeStep = { title: string; description: string; place?: string };
type DiscoveredPlace = {
  name: string;
  place: string;
  coord: string;
  type: string;
  distanceFromOrigin: number;
};

type RouteCandidate = {
  orderedPoints: DiscoveredPlace[];
  durationMinutes: number;
  distanceMeters: number;
};

const WALKING_SPEED_METERS_PER_MINUTE = 75;
const MAX_CANDIDATE_PLACES = 8;
const MAX_COMBINATIONS_TO_TEST = 12;
const MAX_PERMUTATIONS_PER_COMBINATION = 2;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const businessError = (message: string) => jsonResponse({ error: message }, 200);

const normalizePlace = (value: string) => value.trim().toLowerCase();

const permute = <T>(items: T[]): T[][] => {
  if (items.length <= 1) return [items];

  return items.flatMap((item, index) => {
    const remaining = [...items.slice(0, index), ...items.slice(index + 1)];
    return permute(remaining).map((tail) => [item, ...tail]);
  });
};

const combinationsOfThree = <T>(items: T[]): T[][] => {
  const combos: T[][] = [];
  for (let i = 0; i < items.length - 2; i++) {
    for (let j = i + 1; j < items.length - 1; j++) {
      for (let k = j + 1; k < items.length; k++) {
        combos.push([items[i], items[j], items[k]]);
      }
    }
  }
  return combos;
};

const parseCoord = (coord: string) => {
  const [lon, lat] = coord.split(",").map(Number);
  return { lon, lat };
};

const haversineMeters = (from: string, to: string) => {
  const a = parseCoord(from);
  const b = parseCoord(to);
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(h));
};

const estimateLoopDistance = (origin: string, orderedCoords: string[]) => {
  let total = 0;
  let previous = origin;

  for (const coord of orderedCoords) {
    total += haversineMeters(previous, coord);
    previous = coord;
  }

  total += haversineMeters(previous, origin);
  return total;
};

const getSafeDurationLimit = (duration: number) => {
  if (duration <= 20) return Math.max(10, duration - 1);
  return Math.max(10, duration - 2);
};

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
    distanceMeters: Math.round(route.distance ?? 0),
  };
};

const discoverNearbyPlaces = async (
  lat: string,
  lon: string,
  radiusMeters: number,
  interests: string[],
  originCoord: string
): Promise<DiscoveredPlace[]> => {
  const interestFilters: Record<string, string[]> = {
    nature: [
      'node(around:R,LAT,LON)["natural"]',
      'way(around:R,LAT,LON)["natural"]',
      'node(around:R,LAT,LON)["leisure"="park"]',
      'way(around:R,LAT,LON)["leisure"="park"]',
    ],
    architecture: [
      'node(around:R,LAT,LON)["building"]',
      'way(around:R,LAT,LON)["building"]',
      'node(around:R,LAT,LON)["historic"]',
      'way(around:R,LAT,LON)["historic"]',
    ],
    streetart: [
      'node(around:R,LAT,LON)["tourism"="artwork"]',
      'way(around:R,LAT,LON)["tourism"="artwork"]',
    ],
    history: [
      'node(around:R,LAT,LON)["historic"]',
      'way(around:R,LAT,LON)["historic"]',
      'node(around:R,LAT,LON)["memorial"]',
      'way(around:R,LAT,LON)["memorial"]',
    ],
  };

  const fallbackFilters = [
    'node(around:R,LAT,LON)["historic"]',
    'way(around:R,LAT,LON)["historic"]',
    'node(around:R,LAT,LON)["tourism"]',
    'way(around:R,LAT,LON)["tourism"]',
    'node(around:R,LAT,LON)["amenity"]',
    'way(around:R,LAT,LON)["amenity"]',
    'node(around:R,LAT,LON)["natural"]',
    'way(around:R,LAT,LON)["natural"]',
  ];

  const selectedFilters = Array.from(
    new Set(interests.flatMap((interest) => interestFilters[interest] || []).concat(fallbackFilters))
  )
    .map((filter) => filter.replaceAll("R", String(radiusMeters)).replaceAll("LAT", lat).replaceAll("LON", lon))
    .join(";");

  const query = `[out:json][timeout:20];(${selectedFilters};);out center tags 80;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": "Microbalade/1.0 (contact@microbalade.com)",
    },
    body: query,
  });

  if (!response.ok) {
    throw new Error("Impossible de rechercher des lieux proches pour la balade.");
  }

  const data = await response.json();
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  return elements
    .map((element: any) => {
      const tags = element?.tags || {};
      const name = tags.name || tags["addr:street"] || tags["official_name"] || null;
      const pointLat = element?.lat ?? element?.center?.lat;
      const pointLon = element?.lon ?? element?.center?.lon;

      if (!name || pointLat == null || pointLon == null) return null;

      const coord = `${pointLon},${pointLat}`;
      const locality =
        tags["addr:city"] ||
        tags["addr:town"] ||
        tags["addr:village"] ||
        tags["addr:municipality"] ||
        "Longuenesse";

      return {
        name,
        place: `${name}, ${locality}`,
        coord,
        type: tags.historic || tags.natural || tags.tourism || tags.amenity || tags.leisure || "lieu",
        distanceFromOrigin: Math.round(haversineMeters(originCoord, coord)),
      } satisfies DiscoveredPlace;
    })
    .filter(Boolean)
    .filter(
      (place: any, index: number, arr: any[]) =>
        arr.findIndex((item) => normalizePlace(item.place) === normalizePlace(place.place)) === index
    )
    .sort((a: DiscoveredPlace, b: DiscoveredPlace) => a.distanceFromOrigin - b.distanceFromOrigin)
    .slice(0, 16);
};

const discoverNearbyPlacesProgressive = async (
  lat: string,
  lon: string,
  baseRadiusMeters: number,
  interests: string[],
  originCoord: string
) => {
  const radii = Array.from(
    new Set([
      baseRadiusMeters,
      Math.round(baseRadiusMeters * 1.35),
      Math.round(baseRadiusMeters * 1.7),
      Math.max(700, Math.round(baseRadiusMeters * 2)),
      1000,
    ])
  ).sort((a, b) => a - b);

  let best: DiscoveredPlace[] = [];

  for (const radius of radii) {
    try {
      const places = await discoverNearbyPlaces(lat, lon, radius, interests, originCoord);
      if (places.length > best.length) best = places;
      if (places.length >= 4) return places;
    } catch {
      continue;
    }
  }

  return best;
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

const buildFallbackSteps = (places: DiscoveredPlace[]): BaladeStep[] =>
  places.map((place) => ({
    title: place.name,
    description: `${place.name} offre une halte piétonne cohérente dans votre boucle découverte. Prenez le temps d'observer les détails du lieu avant de repartir à pied vers l'étape suivante.`,
    place: place.place,
  }));

const generateNarrativeSteps = async (
  places: DiscoveredPlace[],
  location: string,
  duration: number,
  interestText: string,
  apiKey?: string | null
): Promise<BaladeStep[]> => {
  if (!apiKey) {
    return buildFallbackSteps(places);
  }

  const userPrompt = [
    `Point de départ : ${location}`,
    `Temps total maximum de la boucle : ${duration} minutes à pied`,
    `Thème : ${interestText}`,
    `Écris exactement 3 étapes pour ces lieux et dans cet ordre, sans en changer les noms :`,
    ...places.map((place, index) => `${index + 1}. ${place.place} [${place.type}]`),
  ].join("\n");

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
    });

    if (!response.ok) {
      return buildFallbackSteps(places);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content ?? "{}");
    const steps = Array.isArray(parsed?.steps) ? parsed.steps.slice(0, 3) : [];

    if (steps.length !== 3) {
      return buildFallbackSteps(places);
    }

    const normalizedPlaces = places.map((place) => normalizePlace(place.place));
    const valid = steps.every((step: BaladeStep, index: number) => {
      const description = String(step?.description || "").trim();
      const sentenceCount = description.split(/[.!?]+/).filter((part: string) => part.trim().length > 0).length;
      return normalizePlace(String(step?.place || "")) === normalizedPlaces[index] && sentenceCount === 2;
    });

    if (!valid) {
      return buildFallbackSteps(places);
    }

    return steps.map((step: BaladeStep, index: number) => ({
      title: String(step.title || places[index].name).trim() || places[index].name,
      description: String(step.description || buildFallbackSteps([places[index]])[0].description).trim(),
      place: places[index].place,
    }));
  } catch {
    return buildFallbackSteps(places);
  }
};

const selectBestRoute = async (
  originCoord: string,
  nearbyPlaces: DiscoveredPlace[],
  duration: number
): Promise<RouteCandidate | null> => {
  const candidatePlaces = nearbyPlaces.slice(0, Math.min(nearbyPlaces.length, MAX_CANDIDATE_PLACES));
  if (candidatePlaces.length < 3) return null;

  const safeDurationLimit = getSafeDurationLimit(duration);
  const targetDistanceMeters = safeDurationLimit * WALKING_SPEED_METERS_PER_MINUTE;
  const routeCache = new Map<string, { durationMinutes: number; distanceMeters: number }>();

  const combinations = combinationsOfThree(candidatePlaces)
    .map((combo) => {
      const rankedOrders = permute(combo)
        .map((orderedPoints) => ({
          orderedPoints,
          estimatedDistance: estimateLoopDistance(
            originCoord,
            orderedPoints.map((point) => point.coord)
          ),
        }))
        .filter((entry) => entry.estimatedDistance <= duration * WALKING_SPEED_METERS_PER_MINUTE)
        .sort(
          (a, b) =>
            Math.abs(targetDistanceMeters - a.estimatedDistance) -
            Math.abs(targetDistanceMeters - b.estimatedDistance)
        )
        .slice(0, MAX_PERMUTATIONS_PER_COMBINATION);

      if (rankedOrders.length === 0) return null;

      return {
        score: Math.abs(targetDistanceMeters - rankedOrders[0].estimatedDistance),
        rankedOrders,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.score - b.score)
    .slice(0, MAX_COMBINATIONS_TO_TEST);

  let bestSafeRoute: RouteCandidate | null = null;
  let bestHardRoute: RouteCandidate | null = null;

  for (const combination of combinations as Array<{ rankedOrders: Array<{ orderedPoints: DiscoveredPlace[] }> }>) {
    for (const option of combination.rankedOrders) {
      const routeKey = [originCoord, ...option.orderedPoints.map((point) => point.coord), originCoord].join(";");
      let measured = routeCache.get(routeKey);

      if (!measured) {
        measured = await getWalkingRoute([
          originCoord,
          ...option.orderedPoints.map((point) => point.coord),
          originCoord,
        ]);
        routeCache.set(routeKey, measured);
      }

      const candidate: RouteCandidate = {
        orderedPoints: option.orderedPoints,
        durationMinutes: measured.durationMinutes,
        distanceMeters: measured.distanceMeters,
      };

      if (candidate.durationMinutes <= safeDurationLimit) {
        if (!bestSafeRoute || candidate.durationMinutes > bestSafeRoute.durationMinutes) {
          bestSafeRoute = candidate;
        }
      }

      if (candidate.durationMinutes <= duration) {
        if (!bestHardRoute || candidate.durationMinutes > bestHardRoute.durationMinutes) {
          bestHardRoute = candidate;
        }
      }
    }
  }

  return bestSafeRoute || bestHardRoute;
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

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

    const originResolved = await geocode(location, routeContext);
    if (!originResolved) {
      return businessError("Impossible de localiser précisément le point de départ.");
    }

    const [originLon, originLat] = originResolved.coord.split(",");
    const originLatLng = `${originLat},${originLon}`;
    const maxLoopDistanceMeters = Math.round(duration * WALKING_SPEED_METERS_PER_MINUTE);
    const baseRadiusMeters = Math.max(180, Math.round(maxLoopDistanceMeters / 8));

    const nearbyPlaces = await discoverNearbyPlacesProgressive(
      originLat,
      originLon,
      baseRadiusMeters,
      interests as string[],
      originResolved.coord
    );

    if (nearbyPlaces.length < 3) {
      return businessError(
        `Pas assez de lieux réellement accessibles à pied ont été trouvés autour de cette adresse pour construire une boucle de ${duration} minutes.`
      );
    }

    const selectedRoute = await selectBestRoute(originResolved.coord, nearbyPlaces, duration);

    if (!selectedRoute) {
      return businessError(
        `Impossible de garantir un trajet Google Maps à pied dans ${duration} minutes maximum depuis cette adresse. Essayez une adresse plus centrale ou un temps plus long.`
      );
    }

    const steps = await generateNarrativeSteps(
      selectedRoute.orderedPoints,
      location,
      duration,
      interestText,
      LOVABLE_API_KEY
    );

    const googleMapsUrl = buildGoogleMapsUrl(
      originLatLng,
      selectedRoute.orderedPoints.map((point) => point.coord.split(",").reverse().join(","))
    );

    return jsonResponse({
      steps,
      google_maps_url: googleMapsUrl,
      walking_minutes: selectedRoute.durationMinutes,
      walking_distance_meters: selectedRoute.distanceMeters,
    });
  } catch (e) {
    console.error("generate-balade error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500
    );
  }
});
