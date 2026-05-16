import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type BaladeStep = { title: string; description: string; place?: string };
type Waypoint = { coord: string; label: string };
type RouteMeasurement = { durationMinutes: number; distanceMeters: number };

const WALKING_SPEED_METERS_PER_MINUTE = 75;
const ORIGIN_SEARCH_TIMEOUT_MS = 3500;
const REVERSE_GEOCODE_TIMEOUT_MS = 1800;
const ROUTE_TIMEOUT_MS = 5000;

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

const geocode = async (query: string, context?: string): Promise<{ coord: string; label: string } | null> => {
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

const getWalkingRoute = async (coordinates: string[]): Promise<RouteMeasurement> => {
  const url = `https://router.project-osrm.org/route/v1/foot/${coordinates.join(";")}?overview=false&steps=false`;
  const response = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" } },
    ROUTE_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error("Impossible de calculer un itinéraire piéton fiable.");
  }

  const data = await response.json();
  const route = data?.routes?.[0];
  if (!route?.duration) {
    throw new Error("Aucun itinéraire piéton exploitable n'a été trouvé.");
  }

  return {
    durationMinutes: Math.ceil(route.duration / 60),
    distanceMeters: Math.round(route.distance ?? 0),
  };
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
  const buffer = duration >= 45 ? 6 : duration >= 30 ? 5 : 3;
  return Math.max(10, duration - buffer);
};

const createCandidateLoops = (originCoord: string, duration: number) => {
  const safeLimit = getSafeDurationLimit(duration);
  const targetDistance = safeLimit * WALKING_SPEED_METERS_PER_MINUTE;
  const baseRadius = Math.max(70, Math.min(360, Math.round(targetDistance / 5)));
  const radii = Array.from(
    new Set([0.65, 0.8, 0.95, 1.1, 1.25].map((factor) => Math.max(60, Math.round(baseRadius * factor))))
  );

  const angleTemplates = [
    [15, 130, 255],
    [40, 160, 285],
    [70, 185, 320],
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

const buildDescriptions = (interests: string[]) => {
  const hasNature = interests.includes("nature");
  const hasArchitecture = interests.includes("architecture");
  const hasStreetart = interests.includes("streetart");
  const hasHistory = interests.includes("history");

  return [
    hasArchitecture
      ? "Regardez les façades, les alignements et les détails bâtis que l'on remarque seulement à pied. Cette première halte vous place tout de suite dans un rythme de découverte lente et précise."
      : hasNature
        ? "Prenez quelques secondes pour sentir l'ambiance du quartier et repérer ce qui change dans le paysage quand on avance à pied. Cette première halte lance une boucle courte pensée pour rester confortable dans votre temps disponible."
        : "Cette première halte ouvre la balade avec un point de vue simple à observer sans quitter votre boucle piétonne. Elle vous met immédiatement dans une exploration lente, locale et sans détour inutile.",
    hasStreetart
      ? "Ouvrez l'œil sur les détails visuels, les murs, les textures et les signes du quartier que la voiture efface complètement. À pied, cette portion de trajet devient un vrai moment d'observation plutôt qu'un simple déplacement."
      : hasHistory
        ? "Ici, le rythme piéton aide à lire les traces discrètes du passé dans l'espace autour de vous. La boucle a été calibrée pour préserver ce temps de regard sans dépasser votre durée disponible."
        : "Cette deuxième étape sert de pivot dans une boucle volontairement compacte et mesurée côté serveur. Elle garde un vrai temps d'observation tout en restant strictement compatible avec un trajet à pied.",
    hasNature
      ? "Cette dernière halte referme la boucle avec une respiration plus calme avant le retour. Le parcours Google Maps reste verrouillé en marche et dimensionné pour rentrer dans le temps demandé."
      : "Cette dernière halte prépare un retour direct vers le départ sans rallonge cachée. Le parcours a été retenu uniquement parce que sa durée piétonne mesurée reste dans votre créneau disponible.",
  ];
};

const buildSteps = (waypoints: Waypoint[], interests: string[]): BaladeStep[] => {
  const descriptions = buildDescriptions(interests);
  const titles = ["Premier détour", "Point de passage", "Retour par la boucle"];

  return waypoints.map((waypoint, index) => ({
    title: titles[index] ?? `Étape ${index + 1}`,
    description: descriptions[index] ?? descriptions[descriptions.length - 1],
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

    return jsonResponse({
      steps: buildSteps(waypoints, interests as string[]),
      google_maps_url: buildGoogleMapsUrl(toLatLng(originResolved.coord), waypoints.map((point) => toLatLng(point.coord))),
      walking_minutes: selected.route.durationMinutes,
      walking_distance_meters: selected.route.distanceMeters,
    });
  } catch (e) {
    console.error("generate-balade error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
