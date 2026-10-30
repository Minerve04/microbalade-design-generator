// generate-balade-v2 — moteur « lieux d'abord » (expérimental, non branché sur le site).
// 1. On rassemble les lieux qui valent le détour autour du départ (commune, Mérimée, Wikipédia).
// 2. On choisit les meilleurs qui tiennent dans le temps demandé (orienteering glouton).
// 3. On trace le chemin piéton qui les relie, on ajuste si la mesure réelle dépasse.
// 4. L'IA écrit une étape par lieu, uniquement à partir des faits sourcés.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { findUnsourced, stripSentencesWith } from "./facts.ts";

const ENGINE_VERSION = "v2.0-poi-first";
const WALK_M_PER_MIN = 83; // allure Google Maps
const DETOUR = 1.35; // rapport distance réelle / vol d'oiseau en ville
const STOP_MINUTES = 2; // temps passé à chaque arrêt
const MAX_ROUTE_CALLS = 5;
const UA = { "User-Agent": "Microbalade/1.0 (contact@microbalade.com)" };
const MERIMEE_RESOURCE = "3a52af4a-f9da-4dcc-8110-b07774dfb3bc";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Pt = { lat: number; lon: number };
type Kind = "commune" | "merimee" | "wikipedia";
type Poi = Pt & { id: string; nom: string; texte: string; kind: Kind; source_label: string; source_url: string | null; score: number };

const toRad = (d: number) => (d * Math.PI) / 180;
const dist = (a: Pt, b: Pt) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const withTimeout = (url: string, init: RequestInit, ms: number) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
};
const getJson = async (url: string, ms = 5000) => {
  const r = await withTimeout(url, { headers: UA }, ms);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 60)}`);
  return r.json();
};
const clip = (s: string, n = 600) => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const dot = cut.lastIndexOf(". ");
  return dot > n * 0.5 ? cut.slice(0, dot + 1) : cut + "…";
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ---------- Sources de lieux ----------

// deno-lint-ignore no-explicit-any
const communePois = async (admin: any, o: Pt, radius: number, city: string): Promise<Poi[]> => {
  if (!admin) return [];
  const dLat = radius / 111000, dLon = radius / (111000 * Math.cos(toRad(o.lat)));
  const { data } = await admin
    .from("commune_pois")
    .select("id, nom, description, lat, lon, url_source")
    .eq("active", true)
    .gte("lat", o.lat - dLat).lte("lat", o.lat + dLat)
    .gte("lon", o.lon - dLon).lte("lon", o.lon + dLon)
    .limit(100);
  return (data ?? []).map((p: any) => ({
    id: `c-${p.id}`, nom: p.nom, texte: clip(p.description || p.nom), kind: "commune" as const,
    source_label: `Ville de ${city}`, source_url: p.url_source ?? null, lat: p.lat, lon: p.lon, score: 0,
  }));
};

const GENERIC_WIKI = /^(arrondissement|canton|liste |communaut[ée]|intercommunalit|d[ée]partement|r[ée]gion|ligne |route |autoroute |bataille |gare de )/i;
const GENERIC_WIKI_TEXT = /(est une (?:voie|rue|place|avenue|boulevard|impasse) |est une commune fran[çc]aise|est un canton|est un arrondissement|est une ancienne commune|est un cours d'eau)/i;

const wikipedia = async (o: Pt, radius: number): Promise<Poi[]> => {
  const gs = await getJson(
    `https://fr.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${o.lat.toFixed(5)}|${o.lon.toFixed(5)}&gsradius=${Math.min(10000, Math.round(radius))}&gslimit=40&format=json&origin=*`,
  );
  const hits = (gs?.query?.geosearch ?? []).filter((h: any) => !GENERIC_WIKI.test(h.title));
  if (!hits.length) return [];
  const ex = await getJson(
    `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&exintro=1&explaintext=1&exsentences=4&pageids=${hits.slice(0, 20).map((h: any) => h.pageid).join("|")}&format=json&origin=*`,
  );
  return (Object.values(ex?.query?.pages ?? {}) as any[])
    .filter((pg) => pg.extract && pg.coordinates?.[0] && !GENERIC_WIKI_TEXT.test(pg.extract))
    .map((pg) => ({
      id: `w-${pg.pageid}`, nom: pg.title, texte: clip(pg.extract), kind: "wikipedia" as const,
      source_label: `Wikipédia — ${pg.title}`, source_url: `https://fr.wikipedia.org/?curid=${pg.pageid}`,
      lat: pg.coordinates[0].lat, lon: pg.coordinates[0].lon, score: 0,
    }));
};

const merimee = async (city: string): Promise<Poi[]> => {
  const data = await getJson(
    `https://tabular-api.data.gouv.fr/api/resources/${MERIMEE_RESOURCE}/data/?Commune_forme_index__exact=${encodeURIComponent(city)}&page_size=200`,
  );
  return (data?.data ?? []).map((r: any) => {
    const c = String(r.coordonnees_au_format_WGS84 ?? "").split(",").map(Number);
    const nom = r.Titre_editorial_de_la_notice || r.Denomination_de_l_edifice;
    if (c.length !== 2 || !c.every(Number.isFinite) || !nom) return null;
    const parts = [
      r.Siecle_de_la_campagne_principale_de_construction && `Construction : ${String(r.Siecle_de_la_campagne_principale_de_construction).replace(/;/g, ", ")}.`,
      r.Date_et_typologie_de_la_protection && `Protection : ${String(r.Date_et_typologie_de_la_protection).replace(/;/g, ", ")}.`,
      r.Historique && String(r.Historique),
    ].filter(Boolean);
    return {
      id: `m-${r.Reference}`, nom, texte: clip(parts.join(" ")), kind: "merimee" as const,
      source_label: "Monuments historiques (base Mérimée)", source_url: `https://pop.culture.gouv.fr/notice/merimee/${r.Reference}`,
      lat: c[0], lon: c[1], score: 0,
    };
  }).filter(Boolean) as Poi[];
};

const reverseCity = async (o: Pt): Promise<{ city?: string; postcode?: string; label?: string }> => {
  try {
    const d = await getJson(`https://data.geopf.fr/geocodage/reverse?lon=${o.lon}&lat=${o.lat}&index=address&limit=1`, 3000);
    const p = d?.features?.[0]?.properties;
    if (p) return { city: p.city, postcode: p.postcode, label: [p.street || p.name, p.city].filter(Boolean).join(", ") };
  } catch { /* ignore */ }
  return {};
};

const geocode = async (q: string): Promise<Pt & { label: string } | null> => {
  try {
    const d = await getJson(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=1`, 4000);
    const f = d?.features?.[0];
    if (f) return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: f.properties.label };
  } catch { /* ignore */ }
  return null;
};

// ---------- Choix des lieux ----------

const INTEREST_WORDS: Record<string, RegExp> = {
  architecture: /(eglise|chapelle|cathedrale|abbaye|chateau|maison|hotel|beffroi|halle|moulin|architect|batiment|edifice|facade|gare|pont|manoir|ferme)/,
  history: /(guerre|bombard|memorial|monument aux morts|histoire|ancien|siecle|bataille|cimetiere|tombe|abri|bunker|base|musee|vestige|romain|medieval)/,
  nature: /(parc|jardin|bois|foret|riviere|etang|marais|reserve|plateau|arbre|vallee|canal|lac|source)/,
  streetart: /(fresque|graff|street|mural|art urbain)/,
};

const scorePoi = (p: Poi, interests: string[]) => {
  const base = p.kind === "commune" ? 6 : p.kind === "merimee" ? 5 : 2;
  const txt = norm(`${p.nom} ${p.texte}`);
  const bonus = interests.reduce((s, i) => s + (INTEREST_WORDS[i]?.test(txt) ? 2 : 0), 0);
  const richness = Math.min(2, p.texte.length / 300);
  // Intitulés génériques de la base Mérimée (« Maison », « Immeuble ») : moins parlants pour un promeneur.
  const generic = /^(maison|immeuble|hotel particulier|ferme|croix|borne)\b/.test(norm(p.nom)) ? -2 : 0;
  return base + bonus + richness + generic;
};

// Longueur d'une boucle départ → lieux → départ (vol d'oiseau).
const loopLen = (o: Pt, stops: Poi[]) => {
  let d = 0, prev: Pt = o;
  for (const s of stops) { d += dist(prev, s); prev = s; }
  return d + dist(prev, o);
};
// Insère un lieu à la meilleure position de la boucle.
const bestInsertion = (o: Pt, stops: Poi[], p: Poi) => {
  let best = { idx: 0, len: Infinity };
  for (let i = 0; i <= stops.length; i++) {
    const cand = [...stops.slice(0, i), p, ...stops.slice(i)];
    const len = loopLen(o, cand);
    if (len < best.len) best = { idx: i, len };
  }
  return best;
};

const choose = (o: Pt, pois: Poi[], budgetM: number, maxStops: number) => {
  let stops: Poi[] = [];
  const pool = [...pois];
  while (stops.length < maxStops && pool.length) {
    let pick: { p: Poi; idx: number; len: number; ratio: number } | null = null;
    const cur = loopLen(o, stops);
    for (const p of pool) {
      const ins = bestInsertion(o, stops, p);
      const walk = ins.len * DETOUR + (stops.length + 1) * STOP_MINUTES * WALK_M_PER_MIN;
      if (walk > budgetM) continue;
      const ratio = p.score / Math.max(80, ins.len - cur);
      if (!pick || ratio > pick.ratio) pick = { p, idx: ins.idx, len: ins.len, ratio };
    }
    if (!pick) break;
    stops = [...stops.slice(0, pick.idx), pick.p, ...stops.slice(pick.idx)];
    pool.splice(pool.indexOf(pick.p), 1);
  }
  return stops;
};

// ---------- Itinéraire ----------

const fmt = (p: Pt) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
let routeCalls = 0;
const route = async (pts: Pt[]) => {
  routeCalls++;
  const start = fmt(pts[0]), end = fmt(pts[pts.length - 1]);
  const mid = pts.slice(1, -1).map(fmt).join("|");
  try {
    const d = await getJson(
      `https://data.geopf.fr/navigation/itineraire?resource=bdtopo-valhalla&profile=pedestrian&optimization=shortest&start=${start}&end=${end}&intermediates=${encodeURIComponent(mid)}&geometryFormat=geojson&getSteps=false&getBbox=false&distanceUnit=meter&timeUnit=minute`,
      7000,
    );
    if (typeof d?.distance === "number") return { meters: Math.round(d.distance), geometry: d.geometry.coordinates as [number, number][] };
  } catch (e) { console.warn("geopf route", e); }
  const d = await getJson(`https://router.project-osrm.org/route/v1/foot/${pts.map(fmt).join(";")}?overview=full&geometries=geojson`, 7000);
  const r = d?.routes?.[0];
  if (!r) throw new Error("Pas d'itinéraire");
  return { meters: Math.round(r.distance), geometry: r.geometry.coordinates as [number, number][] };
};

const simplify = (g: [number, number][], max = 300) => {
  if (g.length <= max) return g;
  const step = (g.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => g[Math.round(i * step)]);
};

const mapsUrl = (o: Pt, stops: Poi[]) => {
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("travelmode", "walking");
  u.searchParams.set("origin", `${o.lat},${o.lon}`);
  u.searchParams.set("destination", `${o.lat},${o.lon}`);
  u.searchParams.set("waypoints", stops.map((s) => `${s.lat},${s.lon}`).join("|"));
  return u.toString();
};

// ---------- Texte ----------

const prompt = (city: string, stops: Poi[], minutes: number, corrections?: string[]) => `Tu es un guide local de ${city}. Tu écris une balade à pied de ${minutes} minutes pour un promeneur curieux. Une seule erreur factuelle est inacceptable : une mairie lira ce texte.

Pour CHAQUE lieu ci-dessous, dans l'ordre, écris 3 à 4 phrases qui apprennent quelque chose de vrai, UNIQUEMENT à partir du texte fourni pour ce lieu. Commence par ce qui surprend ou ce qui se voit sur place. Tu peux faire le lien avec le lieu précédent si les textes le permettent.

${stops.map((s, i) => `LIEU ${i + 1} — ${s.nom} (source : ${s.source_label})\n${s.texte}`).join("\n\n")}

RÈGLES :
- Aucun nom, aucune date, aucun nombre qui ne figure pas dans le texte du lieu.
- Pas de formules d'agence touristique (« Découvrez », « magnifique », « incontournable », « au cœur de », « plongez »).
- Pas d'introduction ni de conclusion, pas d'emoji, vouvoiement.
${corrections?.length ? `- CORRECTION : retire ces éléments absents des sources : ${corrections.join(" ; ")}\n` : ""}
Réponds STRICTEMENT en JSON : {"intro":"1 phrase qui annonce le fil de la balade","steps":[{"description":"..."}]}`;

const ai = async (p: string): Promise<{ intro: string; steps: string[] } | null> => {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const r = await withTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: p }],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 2200,
      }),
    }, 25000);
    if (!r.ok) return null;
    const d = await r.json();
    const c = JSON.parse(d?.choices?.[0]?.message?.content ?? "{}");
    if (!Array.isArray(c.steps)) return null;
    return { intro: String(c.intro ?? ""), steps: c.steps.map((s: any) => String(s?.description ?? "").trim()) };
  } catch (e) {
    console.warn("ai", e);
    return null;
  }
};

// ---------- Handler ----------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const t0 = Date.now();
  routeCalls = 0;
  const url = Deno.env.get("SUPABASE_URL"), sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && sk ? createClient(url, sk) : null;
  const timings: Record<string, number> = {};
  try {
    const body = await req.json();
    const duration = Number(body.duration);
    const interests: string[] = Array.isArray(body.interests) && body.interests.length ? body.interests : ["architecture", "history"];
    if (!Number.isFinite(duration) || duration < 15 || duration > 120) return json({ error: "Durée entre 15 et 120 minutes." });

    let o: Pt; let originLabel = String(body.location ?? "");
    if (Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon)) && body.lat !== undefined) {
      o = { lat: Number(body.lat), lon: Number(body.lon) };
    } else {
      const g = body.location ? await geocode(String(body.location)) : null;
      if (!g) return json({ error: "Point de départ introuvable." });
      o = g; originLabel = g.label;
    }

    const budgetM = duration * WALK_M_PER_MIN;
    const radius = budgetM / 2.4; // un lieu au-delà ne laisse pas le temps de revenir
    const info = await reverseCity(o);
    const city = info.city ?? "la commune";
    if (!originLabel) originLabel = info.label ?? city;

    const t1 = Date.now();
    const sources = await Promise.allSettled([
      communePois(admin, o, radius, city),
      info.city ? merimee(info.city) : Promise.resolve([] as Poi[]),
      wikipedia(o, radius),
    ]);
    timings.sources_ms = Date.now() - t1;
    const errors = sources.filter((s) => s.status === "rejected").map((s) => String((s as PromiseRejectedResult).reason));
    const all = sources.flatMap((s) => (s.status === "fulfilled" ? s.value : []));

    // Dédoublonnage : même nom, ou deux lieux à moins de 40 m (on garde la meilleure source).
    const rank = { commune: 0, merimee: 1, wikipedia: 2 } as const;
    const pois: Poi[] = [];
    for (const p of all.sort((a, b) => rank[a.kind] - rank[b.kind])) {
      if (dist(o, p) > radius) continue;
      if (pois.some((q) => norm(q.nom) === norm(p.nom) || dist(q, p) < 60)) continue;
      pois.push({ ...p, score: scorePoi(p, interests) });
    }

    const maxStops = Math.max(3, Math.min(10, Math.round(duration / 7)));
    let stops = choose(o, pois, budgetM, maxStops);
    if (!stops.length) {
      return json({ error: "Aucun lieu remarquable connu à distance de marche. Essayez une durée plus longue.", engine: ENGINE_VERSION, candidates: pois.length, errors });
    }

    // Mesure réelle ; si ça dépasse, on retire le lieu le moins intéressant.
    const t2 = Date.now();
    let measured = await route([o, ...stops, o]);
    while (measured.meters + stops.length * STOP_MINUTES * WALK_M_PER_MIN > budgetM * 1.08 && stops.length > 1 && routeCalls < MAX_ROUTE_CALLS) {
      const worst = stops.reduce((w, s) => (s.score < w.score ? s : w), stops[0]);
      stops = stops.filter((s) => s !== worst);
      measured = await route([o, ...stops, o]);
    }
    timings.route_ms = Date.now() - t2;
    const walkMin = Math.round(measured.meters / WALK_M_PER_MIN);
    const totalMin = walkMin + stops.length * STOP_MINUTES;

    const t3 = Date.now();
    let text = await ai(prompt(city, stops, totalMin));
    let unsourced: string[] = [];
    if (text) {
      const audit = () => text!.steps.map((d, i) => findUnsourced(d, `${stops[i]?.nom ?? ""} ${stops[i]?.texte ?? ""} ${city}`));
      unsourced = audit().flat();
      if (unsourced.length) {
        const retry = await ai(prompt(city, stops, totalMin, unsourced));
        if (retry) text = retry;
        const per = audit();
        text.steps = text.steps.map((d, i) => (per[i]?.length ? stripSentencesWith(d, per[i]) : d));
      }
    }
    timings.ai_ms = Date.now() - t3;

    const steps = stops.map((s, i) => ({
      title: s.nom,
      place: s.nom,
      description: text?.steps[i] && text.steps[i].length > 60 ? text.steps[i] : s.texte,
      sources: [{ label: s.source_label, url: s.source_url }],
    }));

    return json({
      engine: ENGINE_VERSION,
      intro: text?.intro ?? null,
      steps,
      origin: o,
      origin_label: originLabel,
      origin_city: info.city ?? null,
      origin_postcode: info.postcode ?? null,
      walking_minutes: totalMin,
      walking_distance_meters: measured.meters,
      route_geometry: simplify(measured.geometry),
      waypoints: stops.map((s) => ({ lat: s.lat, lon: s.lon, label: s.nom })),
      google_maps_url: mapsUrl(o, stops),
      diagnostics: {
        candidates: pois.length,
        by_source: { commune: pois.filter((p) => p.kind === "commune").length, merimee: pois.filter((p) => p.kind === "merimee").length, wikipedia: pois.filter((p) => p.kind === "wikipedia").length },
        top_candidates: [...pois].sort((a, b) => b.score - a.score).slice(0, 12).map((p) => `${p.nom} (${p.kind}, ${Math.round(dist(o, p))} m, score ${p.score.toFixed(1)})`),
        route_calls: routeCalls,
        unsourced_first: unsourced,
        errors,
        timings: { ...timings, total_ms: Date.now() - t0 },
      },
    });
  } catch (e) {
    console.error("generate-balade-v2", e);
    return json({ error: e instanceof Error ? e.message : "Erreur", engine: ENGINE_VERSION }, 500);
  }
});
