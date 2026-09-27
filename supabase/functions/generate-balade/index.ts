import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { collectFacts, findUnsourced, stripSentencesWith, type Fact } from "./facts.ts";

const PROMPT_VERSION = "v3.3-facts";

const logSearchStat = async (row: {
  ville: string | null;
  code_postal: string | null;
  duree_minutes: number;
  themes: string[];
  monuments: string[];
  origin_address: string | null;
  source?: string | null;
  commune_slug?: string | null;
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
type RouteGeometryPoint = [number, number];
type RouteMeasurement = {
  durationMinutes: number;
  distanceMeters: number;
  overlapRatio: number;
  geometry: RouteGeometryPoint[];
};
type CandidateLoop = { coords: string[]; route: RouteMeasurement; loopAreaSqMeters: number };

// Google Maps walking pace ≈ 5 km/h ≈ 83 m/min. We align on Google's pace so that
// what we promise matches what the user sees in Google Maps.
const EFFECTIVE_WALKING_SPEED_M_PER_MIN = 83;
const ORIGIN_SEARCH_TIMEOUT_MS = 4000;
const REVERSE_GEOCODE_TIMEOUT_MS = 2500;
const ROUTE_TIMEOUT_MS = 6000;
const AI_TIMEOUT_MS = 25000;
const MAX_ACCEPTABLE_OVERLAP_RATIO = 0.18;
const MAX_FALLBACK_OVERLAP_RATIO = 0.32;

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

const UA = { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" };

// Géocodage : Géoplateforme IGN en priorité, Nominatim (fr) en secours.
// Si une commune est identifiable dans le texte, seul un résultat dans cette commune est accepté.
const normTxt = (s: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const geocode = async (query: string): Promise<{ coord: string; label: string } | null | "commune_mismatch"> => {
  const parts = query.split(",").map((p) => p.trim()).filter(Boolean);
  const lastPart = parts.length > 1 ? parts[parts.length - 1] : "";
  const cpInQuery = query.match(/\b\d{5}\b/)?.[0] ?? null;
  const cityFromComma = normTxt(lastPart.replace(/\b\d{5}\b/g, ""));
  const qNorm = ` ${normTxt(query)} `;

  let geoFeatures: any[] = [];
  try {
    const r = await fetchWithTimeout(
      `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=5`,
      {},
      ORIGIN_SEARCH_TIMEOUT_MS
    );
    if (r.ok) geoFeatures = (await r.json())?.features ?? [];
  } catch (e) {
    console.warn("geopf search failed", e);
  }

  // Commune demandée : après la dernière virgule, sinon un nom de city présent dans le texte
  let wantedCity = cityFromComma;
  if (!wantedCity) {
    for (const f of geoFeatures) {
      const c = normTxt(f?.properties?.city ?? "");
      if (c && qNorm.includes(` ${c} `)) { wantedCity = c; break; }
    }
  }
  const constrained = Boolean(wantedCity || cpInQuery);
  const matches = (city: string, pc: string) => {
    if (cpInQuery && pc === cpInQuery) return true;
    if (wantedCity && normTxt(city) === wantedCity) return true;
    return false;
  };

  for (const f of geoFeatures) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = f.properties ?? {};
    if (constrained && !matches(p.city ?? "", p.postcode ?? "")) continue;
    return { coord: formatCoord(c[0], c[1]), label: p.label || query };
  }

  try {
    const r = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=fr&addressdetails=1&accept-language=fr&q=${encodeURIComponent(query)}`,
      { headers: UA },
      ORIGIN_SEARCH_TIMEOUT_MS
    );
    if (r.ok) {
      const data = await r.json();
      for (const d of Array.isArray(data) ? data : []) {
        if (!d?.lat || !d?.lon) continue;
        const a = d.address ?? {};
        const city = a.city || a.town || a.village || a.municipality || "";
        if (constrained && !matches(city, a.postcode ?? "")) continue;
        return { coord: formatCoord(Number(d.lon), Number(d.lat)), label: d.display_name || query };
      }
    }
  } catch (e) {
    console.warn("nominatim search failed", e);
  }
  return constrained ? "commune_mismatch" : null;
};

type ReverseInfo = { label?: string; postcode?: string; city?: string };

// Reverse géocodage unique (libellé + ville + code postal). Géoplateforme puis Nominatim.
const reverseLookup = async (coord: string): Promise<ReverseInfo> => {
  const { lat, lon } = parseCoord(coord);
  try {
    const r = await fetchWithTimeout(
      `https://data.geopf.fr/geocodage/reverse?lon=${lon}&lat=${lat}&index=address&limit=1`,
      {},
      REVERSE_GEOCODE_TIMEOUT_MS
    );
    if (r.ok) {
      const data = await r.json();
      const p = data?.features?.[0]?.properties;
      if (p) {
        const name = p.street || p.name;
        const label = [name, p.city].filter(Boolean).join(", ") || p.label;
        return { label, postcode: p.postcode || undefined, city: p.city || undefined };
      }
    }
  } catch (e) {
    console.warn("geopf reverse failed", e);
  }
  try {
    const r = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr&addressdetails=1`,
      { headers: UA },
      REVERSE_GEOCODE_TIMEOUT_MS
    );
    if (r.ok) {
      const data = await r.json();
      const a = data?.address || {};
      const name = a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb;
      const city = a.city || a.town || a.village || a.municipality;
      return {
        label: [name, city].filter(Boolean).join(", ") || data?.display_name,
        postcode: a.postcode || undefined,
        city: city || undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return {};
};

const getSegmentKey = (a: RouteGeometryPoint, b: RouteGeometryPoint) => {
  const pointA = `${a[0].toFixed(5)},${a[1].toFixed(5)}`;
  const pointB = `${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  return pointA <= pointB ? `${pointA}|${pointB}` : `${pointB}|${pointA}`;
};

const getSegmentDistanceMeters = (a: RouteGeometryPoint, b: RouteGeometryPoint) => {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const earthRadius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const computeOverlapRatio = (geometry: RouteGeometryPoint[]) => {
  if (geometry.length < 2) return 1;

  let totalDistance = 0;
  let repeatedDistance = 0;
  const seenSegments = new Set<string>();

  for (let index = 0; index < geometry.length - 1; index += 1) {
    const segmentStart = geometry[index];
    const segmentEnd = geometry[index + 1];
    const segmentDistance = getSegmentDistanceMeters(segmentStart, segmentEnd);
    if (segmentDistance < 2) continue;

    totalDistance += segmentDistance;
    const segmentKey = getSegmentKey(segmentStart, segmentEnd);
    if (seenSegments.has(segmentKey)) {
      repeatedDistance += segmentDistance;
    } else {
      seenSegments.add(segmentKey);
    }
  }

  return totalDistance > 0 ? repeatedDistance / totalDistance : 1;
};

// Itinéraire piéton : Géoplateforme IGN (bdtopo-osrm, piéton), OSRM public en secours.
// On se fie à la DISTANCE ; la durée est recalculée à 83 m/min (allure Google Maps).
const routeCounter = { calls: 0 };

const buildMeasurement = (distance: number, geometry: RouteGeometryPoint[]): RouteMeasurement => {
  const distanceMeters = Math.round(distance);
  return {
    durationMinutes: Math.round(distanceMeters / EFFECTIVE_WALKING_SPEED_M_PER_MIN),
    distanceMeters,
    overlapRatio: computeOverlapRatio(geometry),
    geometry,
  };
};

const getWalkingRoute = async (coordinates: string[]): Promise<RouteMeasurement> => {
  routeCounter.calls += 1;
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const intermediates = coordinates.slice(1, -1).join("|");
  const url =
    `https://data.geopf.fr/navigation/itineraire?resource=bdtopo-osrm&profile=pedestrian&optimization=shortest` +
    `&start=${start}&end=${end}&intermediates=${encodeURIComponent(intermediates)}` +
    `&geometryFormat=geojson&getSteps=false&getBbox=false&distanceUnit=meter&timeUnit=minute`;
  try {
    const r = await fetchWithTimeout(url, {}, ROUTE_TIMEOUT_MS);
    if (r.ok) {
      const data = await r.json();
      const geometry = data?.geometry?.coordinates;
      if (typeof data?.distance === "number" && Array.isArray(geometry)) {
        return buildMeasurement(data.distance, geometry as RouteGeometryPoint[]);
      }
    } else {
      console.warn("geopf route non-2xx", r.status);
    }
  } catch (e) {
    console.warn("geopf route failed", e);
  }
  const osrm = `https://router.project-osrm.org/route/v1/foot/${coordinates.join(";")}?overview=full&geometries=geojson&steps=false`;
  const r = await fetchWithTimeout(osrm, { headers: UA }, ROUTE_TIMEOUT_MS);
  if (!r.ok) throw new Error("Routing unreachable");
  const data = await r.json();
  const route = data?.routes?.[0];
  if (!route || typeof route.distance !== "number") throw new Error("No route");
  return buildMeasurement(route.distance, (route.geometry?.coordinates ?? []) as RouteGeometryPoint[]);
};

const simplifyGeometry = (geometry: RouteGeometryPoint[], maxPoints = 300) => {
  if (geometry.length <= maxPoints) return geometry.map(([lo, la]) => [+lo.toFixed(6), +la.toFixed(6)]);
  const step = (geometry.length - 1) / (maxPoints - 1);
  const out: RouteGeometryPoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const [lo, la] = geometry[Math.round(i * step)];
    out.push([+lo.toFixed(6), +la.toFixed(6)]);
  }
  return out;
};

const sampleRouteGeometry = (geometry: RouteGeometryPoint[], desiredPoints = 8) => {
  if (geometry.length <= desiredPoints) return geometry;
  const result: RouteGeometryPoint[] = [];
  const lastIndex = geometry.length - 1;
  for (let i = 1; i <= desiredPoints; i += 1) {
    const index = Math.round((i * lastIndex) / (desiredPoints + 1));
    const point = geometry[Math.min(lastIndex, Math.max(0, index))];
    if (!point) continue;
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) result.push(point);
  }
  return result;
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

const getBaseLoopRadiusMeters = (duration: number) => {
  const safeLimit = getSafeDurationLimit(duration);
  const targetWalkingMeters = safeLimit * EFFECTIVE_WALKING_SPEED_M_PER_MIN;
  return Math.max(60, Math.min(500, Math.round(targetWalkingMeters / 7)));
};

const getMinLoopAreaSqMeters = (duration: number) => {
  const baseRadius = getBaseLoopRadiusMeters(duration);
  return Math.max(8000, Math.round(baseRadius * baseRadius * 0.4));
};

const getMinFallbackLoopAreaSqMeters = (duration: number) => Math.round(getMinLoopAreaSqMeters(duration) * 0.6);

// Minimum acceptable duration: we refuse loops that are way under target (e.g. half).
const getMinAcceptableDuration = (duration: number) => Math.max(10, Math.floor(duration * 0.85));

// Build a wide pool of candidate loops sized for the EFFECTIVE walking speed.
// We over-sample (more angles, more radii, including tiny emergency loops) so that
// dense city centers with canals, one-way streets or river crossings still yield
// at least one candidate whose measured OSRM walking time fits the budget.
const createCandidateLoops = (originCoord: string, duration: number) => {
  // 3-waypoint loop perimeter ≈ ~7 * radius after street detours.
  const baseRadius = getBaseLoopRadiusMeters(duration);
  // Favor radii near target, but also probe compact urban loops. Some city centers
  // only yield valid walking circuits when the waypoints are much tighter than the
  // theoretical radius, because canals, dead ends and pedestrian geometry create large detours.
  const radiusFactors = [0.55, 0.7, 0.85, 0.95, 1.0, 1.05, 1.15, 1.25];
  const dynamicRadii = radiusFactors.map((f) => Math.max(30, Math.round(baseRadius * f)));
  // Lower bound on candidate radii. Without this, dense pedestrian networks in
  // rural areas can produce 30 m "loops" whose 3 waypoints all snap to the same
  // road segment — OSRM may still measure a long detour, but Google Maps will
  // show a 1-minute trip. Floor scales with requested duration.
  const minRadius = Math.max(60, Math.round(baseRadius * 0.45));
  const compactRadii = [60, 80, 100, 130, 160, 200].filter((r) => r >= minRadius);
  const radii = Array.from(new Set([...compactRadii, ...dynamicRadii.filter((r) => r >= minRadius)])).sort((a, b) => a - b);

  // Only well-distributed angle templates: each consecutive gap stays under ~180°
  // so the 3 waypoints form a real triangle around the origin. Half-circle templates
  // (e.g. [0, 90, 180]) are excluded because they force the return leg to overlap
  // the outbound leg — exactly the backtracking we want to avoid.
  const angleTemplates = [
    [0, 120, 240],
    [15, 135, 255],
    [30, 150, 270],
    [45, 165, 285],
    [60, 180, 300],
    [75, 195, 315],
    [90, 210, 330],
    [105, 225, 345],
    [20, 140, 260],
    [50, 170, 290],
    [80, 200, 320],
    [10, 130, 250],
    [40, 160, 280],
  ];
  return radii.flatMap((radius) =>
    angleTemplates.map((angles) => angles.map((angle) => offsetCoordinate(originCoord, radius, angle)))
  );
};

const computeLoopAreaSqMeters = (coordinates: string[]) => {
  if (coordinates.length < 3) return 0;

  const points = coordinates.map(parseCoord);
  const averageLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = Math.cos((averageLat * Math.PI) / 180) * 111320;

  const projected = points.map(({ lon, lat }) => ({ x: lon * metersPerDegreeLon, y: lat * metersPerDegreeLat }));

  let area = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) / 2;
};

const buildGoogleMapsUrl = (origin: string, routeGeometry: RouteGeometryPoint[]) => {
  const url = new URL("https://www.google.com/maps/dir/");
  const sampledWaypoints = sampleRouteGeometry(routeGeometry)
    .map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`)
    .filter((coord) => coord !== origin);

  url.searchParams.set("api", "1");
  url.searchParams.set("travelmode", "walking");
  url.searchParams.set("dir_action", "navigate");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", origin);
  if (sampledWaypoints.length > 0) {
    url.searchParams.set("waypoints", sampledWaypoints.join("|"));
  }
  return url.toString();
};

// Fallbacks used only when the AI call fails. They reference the actual street label
// to avoid the "generic guide" feel as much as possible.
const buildFallbackDescription = (placeLabel: string, index: number) => {
  const street = placeLabel.split(",")[0].trim();
  if (index === 0)
    return `En vous engageant dans ${street}, observez les façades, les enseignes et les matériaux qui racontent la couche la plus visible du quartier. Prenez le temps de lever les yeux : corniches, ferronneries, encadrements de fenêtres livrent souvent l'âge et l'usage d'origine des bâtiments.`;
  if (index === 1)
    return `${street} constitue un point d'articulation typique de ce secteur, où l'on bascule d'une ambiance à une autre — commerces, habitat, espace public. Cherchez un détail singulier (plaque, marque ancienne, décor de devanture) : c'est souvent là que se loge la mémoire du lieu.`;
  return `Le retour par ${street} change radicalement votre angle de vue sur le quartier traversé. Notez la végétation, les jardins entrevus et les perspectives qui se dégagent — c'est la portion la plus propice à repérer ce que vous aviez manqué à l'aller.`;
};

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
  walkingMinutes: number,
  facts: Fact[],
  corrections?: string[]
) => {
  const interestsHuman = interests.map((i) => INTEREST_LABELS[i] || i).join(", ");
  const stepsList = waypointLabels.map((label, i) => `${i + 1}. ${label}`).join("\n");
  const cityLine = city ? `Ville : ${city}\n` : "";
  const factsBlock = facts.length
    ? facts
        .map((f) => `[${f.id}] (étape la plus proche : ${f.etape_la_plus_proche}, ${f.distance_m} m du tracé, source : ${f.source_label}) ${f.titre} — ${f.texte}`)
        .join("\n")
    : "(aucun fait vérifié disponible pour cette boucle)";
  const correctionBlock = corrections?.length
    ? `\n═══ CORRECTION OBLIGATOIRE ═══\nTa réponse précédente contenait des éléments NON présents dans les faits. Retire ou remplace : ${corrections.join(" ; ")}\n`
    : "";
  return `Tu es un guide local de ${city || "cette ville"}. Tu écris pour un promeneur qui veut apprendre quelque chose de VRAI à chaque étape, pas être flatté avec des phrases d'agence touristique. Face à une mairie, une seule erreur factuelle est inacceptable.

Départ : ${originLabel}
${cityLine}Durée mesurée : ${walkingMinutes} minutes à pied
Centres d'intérêt du promeneur : ${interestsHuman}

Étapes RÉELLES de la boucle (dans l'ordre) :
${stepsList}

═══ FAITS VÉRIFIÉS ═══
${factsBlock}

═══ RÈGLE ABSOLUE — ZÉRO INVENTION ═══
- Tout nom propre (personne, édifice, institution, ordre religieux), toute date, tout siècle, tout nombre et toute anecdote DOIT provenir d'un fait ci-dessus, et ce fait doit être cité dans "fact_ids".
- Interdiction de numéros de rue, de dates, de siècles ou de noms qui ne figurent pas dans les faits. Tu peux nommer la rue de l'étape et la ville.
- Privilégie les faits dont la source est « Ville de … » (lieux validés par la commune), puis Mérimée, puis Wikipédia. Utilise en priorité les faits dont "étape la plus proche" correspond à l'étape.
- Ne JAMAIS déduire l'histoire, l'usage passé ou l'origine d'un lieu à partir de son nom (rue, impasse, chemin, lieu-dit). Exemple interdit : « Rue de la Draisine, une voie qui fut autrefois un axe pour des véhicules légers ».
- Si une étape n'a aucun fait pertinent : décris UNIQUEMENT ce qui est observable sur place (bâti, matériaux, végétation, ambiance) et la sécurité du piéton (trottoir, accotement, circulation), sans aucune affirmation historique, sans nom propre autre que la rue, sans date ni chiffre. "fact_ids" est alors [].
- Chaque étape : 3 à 4 phrases.

INTERDICTIONS DE FORMULES (et toute variante équivalente) :
"Découvrez…", "Admirez…", "Magnifique", "Splendide", "Charmant", "Pittoresque", "Authentique", "Ne manquez pas", "Laissez-vous porter", "Laissez la cadence", "Ouvrez l'œil", "Gardez les yeux levés", "Plongez dans…", "Au cœur de…", "Véritable joyau", "Incontournable", "Magnifique église", "Belle architecture", "Riche histoire", "Ambiance unique", "Ce pivot relie deux ambiances".

═══ SÉCURITÉ PIÉTON (ZONES RURALES / PÉRIURBAINES) ═══
- Valorise les axes calmes (sentiers, chemins, rues résidentielles) sans les nommer s'ils ne sont pas la rue de l'étape.
- Si l'étape longe visiblement une route passante sans trottoir, avertis brièvement (marcher face à la circulation, accotement), sans inventer de numéro de route.
- Ton bienveillant et discret, honnête avant marketing.
${correctionBlock}
═══ FORMAT DE SORTIE ═══
- Pas d'introduction, pas de conclusion, pas de titre, pas de liste, pas d'emoji.
- Varie le ton entre les étapes.
- Réponds STRICTEMENT en JSON valide :
{"steps":[{"description":"...","fact_ids":["F2"]},{"description":"...","fact_ids":[]},{"description":"...","fact_ids":["F5"]}]}`;
};

type AiStep = { description: string; fact_ids: string[] };

const generateAiDescriptions = async (prompt: string): Promise<AiStep[] | null> => {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  try {
    const response = await fetchWithTimeout(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.4,
          max_tokens: 1800,
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
    if (!Array.isArray(parsed?.steps)) return null;
    return parsed.steps.map((s: any) => ({
      description: typeof s?.description === "string" ? s.description.trim() : "",
      fact_ids: Array.isArray(s?.fact_ids) ? s.fact_ids.filter((x: unknown) => typeof x === "string") : [],
    }));
  } catch (e) {
    console.warn("AI generation failed:", e);
    return null;
  }
};

// Liste des éléments non sourcés, par étape.
const auditSteps = (steps: AiStep[], labels: string[], city: string | undefined, facts: Fact[], originLabel = "") =>
  steps.map((s, i) => {
    const cited = facts.filter((f) => s.fact_ids.includes(f.id));
    const corpus = [labels[i] ?? "", city ?? "", originLabel, ...cited.map((f) => `${f.titre} ${f.texte}`)].join(" \n ");
    return findUnsourced(s.description, corpus);
  });

type FinalStep = BaladeStep & { sources: { label: string; url: string | null }[] };

const buildSteps = (waypoints: Waypoint[], ai: AiStep[] | null, facts: Fact[]): FinalStep[] => {
  const titles = ["Premier détour", "Point de passage", "Retour par la boucle"];
  return waypoints.map((waypoint, index) => {
    const s = ai?.[index];
    const useAi = s && s.description.length >= 120;
    const cited = useAi ? facts.filter((f) => s!.fact_ids.includes(f.id)) : [];
    return {
      title: titles[index] ?? `Étape ${index + 1}`,
      description: useAi ? s!.description : buildFallbackDescription(waypoint.label, index),
      place: waypoint.label,
      fact_ids: cited.map((f) => f.id),
      sources: cited.map((f) => ({ label: f.source_label, url: f.source_url })),
    } as FinalStep;
  });
};

const ANGLE_TEMPLATES = [
  [0, 120, 240],
  [20, 140, 260],
  [40, 160, 280],
  [60, 180, 300],
  [80, 200, 320],
  [100, 220, 340],
];
const MAX_ROUTE_CALLS = 24;
const RATE_LIMIT_PER_HOUR = 20;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const getAdminClient = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key) : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  routeCounter.calls = 0;
  const admin = getAdminClient();
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim() || "unknown";

  const logRequest = (
    status: string,
    error: string | null,
    cacheHit = false,
    extra: { unsourced_count?: number; ai_retried?: boolean } = {}
  ) => {
    if (!admin) return;
    admin
      .from("generation_requests")
      .insert({ ip, status, error, duration_ms: Date.now() - startedAt, cache_hit: cacheHit, ...extra })
      .then(({ error: e }) => e && console.error("log request error:", e.message));
  };
  const fail = (message: string, status = "error") => {
    logRequest(status, message);
    return businessError(message);
  };

  try {
    const body = await req.json();
    const { location, duration, interests } = body;
    const statSource = ["qr", "page", "direct"].includes(body.source) ? body.source : "direct";
    const statSlug = typeof body.commune_slug === "string" && /^[a-z0-9-]{1,80}$/.test(body.commune_slug) ? body.commune_slug : null;
    const latIn = Number(body.lat);
    const lonIn = Number(body.lon);
    const hasCoords =
      body.lat !== undefined && body.lon !== undefined &&
      Number.isFinite(latIn) && Number.isFinite(lonIn) &&
      Math.abs(latIn) <= 90 && Math.abs(lonIn) <= 180 && !(latIn === 0 && lonIn === 0);

    if (!hasCoords && (!location || typeof location !== "string")) {
      return fail("Veuillez indiquer un point de départ valide.", "invalid");
    }
    if (!Number.isFinite(duration) || duration < 15 || duration > 120) {
      return fail("Le temps disponible doit être compris entre 15 et 120 minutes.", "invalid");
    }
    if (!Array.isArray(interests) || interests.length === 0 || interests.some((i: unknown) => typeof i !== "string")) {
      return fail("Choisissez au moins un centre d'intérêt.", "invalid");
    }

    // Limitation de débit par IP
    if (admin) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await admin
        .from("generation_requests")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip)
        .gte("created_at", since)
        .in("status", ["success", "error"]);
      if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
        return fail("Vous avez atteint la limite de balades pour l'instant, réessayez dans une heure.", "rate_limited");
      }
    }

    // Point de départ
    let originCoord: string;
    let originLabel: string = typeof location === "string" && location ? location : "";
    if (hasCoords) {
      originCoord = formatCoord(lonIn, latIn);
    } else {
      const resolved = await geocode(location);
      if (resolved === "commune_mismatch") return fail("Adresse introuvable dans cette commune. Choisissez une suggestion dans la liste ou utilisez « Me localiser ».");
      if (!resolved) return fail("Impossible de localiser précisément le point de départ.");
      originCoord = resolved.coord;
      originLabel = resolved.label;
    }

    const origin = parseCoord(originCoord);
    const sortedInterests = [...(interests as string[])].sort();
    const cacheKey = `${PROMPT_VERSION}|${origin.lat.toFixed(3)},${origin.lon.toFixed(3)}|${duration}|${sortedInterests.join(",")}`;

    // Cache
    if (admin) {
      const { data: cached } = await admin
        .from("balade_cache")
        .select("response, created_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (cached && Date.now() - new Date(cached.created_at).getTime() < CACHE_TTL_MS) {
        const resp = cached.response as any;
        logSearchStat({
          ville: resp.origin_city ?? null,
          code_postal: resp.origin_postcode ?? null,
          duree_minutes: duration,
          themes: interests as string[],
          monuments: (resp.waypoints ?? []).map((w: any) => w.label),
          origin_address: originLabel || resp.origin_label || null,
          source: statSource,
          commune_slug: statSlug,
        });
        logRequest("success", null, true);
        return jsonResponse({ ...resp, cache_hit: true, route_calls: 0 });
      }
    }

    const safeLimit = getSafeDurationLimit(duration);
    const minAcceptable = getMinAcceptableDuration(duration);
    const minLoopAreaSqMeters = getMinLoopAreaSqMeters(duration);
    const minFallbackLoopAreaSqMeters = getMinFallbackLoopAreaSqMeters(duration);
    const baseRadius = getBaseLoopRadiusMeters(duration);
    const targetMeters = ((minAcceptable + safeLimit) / 2) * EFFECTIVE_WALKING_SPEED_M_PER_MIN;
    const minRadius = Math.max(60, Math.round(baseRadius * 0.35));
    const maxRadius = Math.round(baseRadius * 3);

    let bestCloseToTarget: CandidateLoop | null = null;
    let bestWithinHard: CandidateLoop | null = null;
    let bestLowOverlap: CandidateLoop | null = null;

    const better = (a: CandidateLoop, b: CandidateLoop | null) =>
      !b ||
      a.route.durationMinutes > b.route.durationMinutes ||
      (a.route.durationMinutes === b.route.durationMinutes &&
        (a.route.overlapRatio < b.route.overlapRatio ||
          (a.route.overlapRatio === b.route.overlapRatio && a.loopAreaSqMeters > b.loopAreaSqMeters)));

    const consider = (loop: string[], route: RouteMeasurement) => {
      const cand: CandidateLoop = { coords: loop, route, loopAreaSqMeters: computeLoopAreaSqMeters(loop) };
      if (route.durationMinutes > duration) return;
      const isClean = cand.loopAreaSqMeters >= minLoopAreaSqMeters && route.overlapRatio <= MAX_ACCEPTABLE_OVERLAP_RATIO;
      if (
        route.overlapRatio <= MAX_FALLBACK_OVERLAP_RATIO &&
        cand.loopAreaSqMeters >= minFallbackLoopAreaSqMeters &&
        better(cand, bestLowOverlap)
      ) bestLowOverlap = cand;
      if (isClean && better(cand, bestWithinHard)) bestWithinHard = cand;
      if (isClean && route.durationMinutes >= minAcceptable && better(cand, bestCloseToTarget)) bestCloseToTarget = cand;
    };

    // Passes 1→3 : 6 gabarits en parallèle, rayon ajusté par ratio distance cible / mesurée.
    const radii = ANGLE_TEMPLATES.map(() => baseRadius);
    for (let pass = 0; pass < 3; pass += 1) {
      if (routeCounter.calls + ANGLE_TEMPLATES.length > MAX_ROUTE_CALLS) break;
      const results = await Promise.allSettled(
        ANGLE_TEMPLATES.map(async (angles, t) => {
          // Étalement léger : la Géoplateforme limite à ~5 requêtes/s par IP.
          await new Promise((res) => setTimeout(res, t * 220));
          const loop = angles.map((a) => offsetCoordinate(originCoord, radii[t], a));
          const route = await getWalkingRoute([originCoord, ...loop, originCoord]);
          return { t, loop, route };
        })
      );
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { t, loop, route } = r.value;
        consider(loop, route);
        if (route.distanceMeters > 0) {
          const ratio = Math.min(2.5, Math.max(0.4, targetMeters / route.distanceMeters));
          radii[t] = Math.min(maxRadius, Math.max(minRadius, Math.round(radii[t] * ratio)));
        }
      }
      if (bestCloseToTarget) break;
    }

    const selected: CandidateLoop | null = bestCloseToTarget || bestWithinHard || bestLowOverlap;
    if (!selected) {
      return fail(
        "Impossible de tracer une vraie boucle à pied satisfaisante depuis cette adresse sans repasser sur ses pas. Essayez un autre point de départ proche ou une durée légèrement plus longue."
      );
    }

    const [originInfo, ...wpInfos] = await Promise.all([
      reverseLookup(originCoord),
      ...selected.coords.map((c) => reverseLookup(c)),
    ]);
    const waypointLabels = wpInfos.map((w, i) => w.label || `Point de balade ${i + 1}`);
    if (!originLabel) originLabel = originInfo.label || `${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}`;

    const waypoints: Waypoint[] = selected.coords.map((coord, index) => ({ coord, label: waypointLabels[index] }));

    const factsStart = Date.now();
    const { facts, counts: factCounts, errors: factErrors } = await collectFacts({
      admin,
      route: selected.route.geometry,
      steps: selected.coords.map((c) => parseCoord(c)),
      postcode: originInfo.postcode,
      city: originInfo.city,
      timeoutMs: 4000,
    });
    const factsMs = Date.now() - factsStart;
    if (factErrors.length) console.warn("facts errors:", factErrors.join(" | "));

    const promptArgs = [originLabel, originInfo.city, waypointLabels, interests as string[], selected.route.durationMinutes, facts] as const;
    let aiDescriptions = await generateAiDescriptions(buildAiPrompt(...promptArgs));
    let unsourcedFirst: string[] = [];
    let unsourcedFinal: string[] = [];
    let aiRetried = false;
    if (aiDescriptions) {
      unsourcedFirst = auditSteps(aiDescriptions, waypointLabels, originInfo.city, facts, originLabel).flat();
      if (unsourcedFirst.length) {
        aiRetried = true;
        const retry = await generateAiDescriptions(buildAiPrompt(...promptArgs, unsourcedFirst));
        if (retry) aiDescriptions = retry;
        const perStep = auditSteps(aiDescriptions, waypointLabels, originInfo.city, facts, originLabel);
        unsourcedFinal = perStep.flat();
        aiDescriptions = aiDescriptions.map((s, i) =>
          perStep[i].length ? { ...s, description: stripSentencesWith(s.description, perStep[i]) } : s
        );
      }
    }
    const steps = buildSteps(waypoints, aiDescriptions, facts);

    logSearchStat({
      ville: originInfo.city ?? null,
      code_postal: originInfo.postcode ?? null,
      duree_minutes: duration,
      themes: interests as string[],
      monuments: waypointLabels,
      origin_address: originLabel,
      source: statSource,
      commune_slug: statSlug,
    });

    const response = {
      steps,
      google_maps_url: buildGoogleMapsUrl(toLatLng(originCoord), selected.route.geometry),
      walking_minutes: selected.route.durationMinutes,
      walking_distance_meters: selected.route.distanceMeters,
      origin_postcode: originInfo.postcode ?? null,
      origin_city: originInfo.city ?? null,
      origin_label: originLabel,
      origin: { lat: origin.lat, lon: origin.lon },
      facts: facts.map(({ kind: _k, ...f }) => f),
      route_geometry: simplifyGeometry(selected.route.geometry),
      waypoints: waypoints.map((w) => {
        const c = parseCoord(w.coord);
        return { lat: c.lat, lon: c.lon, label: w.label };
      }),
    };

    if (admin && aiDescriptions) {
      admin
        .from("balade_cache")
        .upsert({ cache_key: cacheKey, response, created_at: new Date().toISOString() })
        .then(({ error: e }) => e && console.error("cache write error:", e.message));
    }
    logRequest("success", null, false, { unsourced_count: unsourcedFirst.length, ai_retried: aiRetried });
    console.log(`generate-balade ok: ${routeCounter.calls} route calls, ${Date.now() - startedAt} ms`);
    return jsonResponse({
      ...response,
      cache_hit: false,
      route_calls: routeCounter.calls,
      diagnostics: { fact_counts: factCounts, fact_errors: factErrors, facts_ms: factsMs, unsourced_first: unsourcedFirst, unsourced_final: unsourcedFinal, ai_retried: aiRetried },
    });
  } catch (e) {
    console.error("generate-balade error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    logRequest("error", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
