// Collecte de faits sourcés autour d'une boucle : lieux validés par la commune,
// Wikipédia FR (geosearch), Monuments historiques (base Mérimée via data.gouv.fr).

export type Fact = {
  id: string;
  titre: string;
  texte: string;
  source_label: string;
  source_url: string | null;
  distance_m: number;
  etape_la_plus_proche: number; // 1..n
  kind: "commune" | "wikipedia" | "merimee";
};

type LonLat = [number, number];
type Pt = { lat: number; lon: number };

const UA = { "User-Agent": "Microbalade/1.0 (https://microbalade.com; contact@microbalade.com)" };
const MAX_DIST_M = 150;
const MAX_FACTS = 12;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MERIMEE_RESOURCE = "3a52af4a-f9da-4dcc-8110-b07774dfb3bc";

const toRad = (d: number) => (d * Math.PI) / 180;
export const haversine = (a: Pt, b: Pt) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const distToSegment = (p: Pt, a: Pt, b: Pt) => {
  const kx = 111320 * Math.cos(toRad(p.lat));
  const ky = 110540;
  const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
};

const distToRoute = (p: Pt, route: LonLat[]) => {
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const d = distToSegment(p, { lon: route[i][0], lat: route[i][1] }, { lon: route[i + 1][0], lat: route[i + 1][1] });
    if (d < best) best = d;
  }
  return route.length === 1 ? haversine(p, { lon: route[0][0], lat: route[0][1] }) : best;
};

const nearestStep = (p: Pt, steps: Pt[]) => {
  let best = 0, bd = Infinity;
  steps.forEach((s, i) => {
    const d = haversine(p, s);
    if (d < bd) { bd = d; best = i; }
  });
  return best + 1;
};

const clip = (s: string, n = 600) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const lastDot = cut.lastIndexOf(". ");
  return lastDot > n * 0.5 ? cut.slice(0, lastDot + 1) : cut.trim() + "…";
};

const GENERIC_WIKI = /^(arrondissement|canton|liste |communaut[ée]|intercommunalit|d[ée]partement|r[ée]gion|gare |ligne |route |autoroute |bataille )/i;
const GENERIC_WIKI_TEXT = /(est une (?:voie|rue|place|avenue|boulevard|impasse) (?:de|du|situ|publique)|est une commune fran[çc]aise|est un canton|est un arrondissement|est une ancienne commune)/i;

const fetchJson = async (url: string, signal: AbortSignal) => {
  const r = await fetch(url, { headers: UA, signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// deno-lint-ignore no-explicit-any
const cached = async <T>(admin: any, key: string, loader: () => Promise<T>): Promise<T> => {
  if (admin) {
    const { data } = await admin.from("facts_cache").select("payload, created_at").eq("cache_key", key).maybeSingle();
    if (data && Date.now() - new Date(data.created_at).getTime() < CACHE_TTL_MS) return data.payload as T;
  }
  const value = await loader();
  if (admin) {
    admin.from("facts_cache").upsert({ cache_key: key, payload: value, created_at: new Date().toISOString() })
      .then(({ error }: { error: { message: string } | null }) => error && console.error("facts_cache write:", error.message));
  }
  return value;
};

type RawFact = { titre: string; texte: string; source_label: string; source_url: string | null; lat: number; lon: number; kind: Fact["kind"] };

// deno-lint-ignore no-explicit-any
const wikipediaAround = (admin: any, p: Pt, signal: AbortSignal) =>
  cached<RawFact[]>(admin, `wiki|${p.lat.toFixed(3)},${p.lon.toFixed(3)}`, async () => {
    const gs = await fetchJson(
      `https://fr.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${p.lat.toFixed(5)}|${p.lon.toFixed(5)}&gsradius=300&gslimit=10&format=json&origin=*`,
      signal,
    );
    const hits = (gs?.query?.geosearch ?? []).filter((h: any) => !GENERIC_WIKI.test(h.title));
    if (!hits.length) return [];
    const ids = hits.map((h: any) => h.pageid).join("|");
    const ex = await fetchJson(
      `https://fr.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&exintro=1&explaintext=1&exsentences=4&pageids=${ids}&format=json&origin=*`,
      signal,
    );
    const pages = Object.values(ex?.query?.pages ?? {}) as any[];
    return pages
      .filter((pg) => pg.extract && pg.coordinates?.[0] && !GENERIC_WIKI_TEXT.test(pg.extract))
      .map((pg) => ({
        titre: pg.title,
        texte: clip(pg.extract),
        source_label: `Wikipédia — ${pg.title}`,
        source_url: `https://fr.wikipedia.org/?curid=${pg.pageid}`,
        lat: pg.coordinates[0].lat,
        lon: pg.coordinates[0].lon,
        kind: "wikipedia" as const,
      }));
  });

// deno-lint-ignore no-explicit-any
const merimeeForCity = (admin: any, city: string, signal: AbortSignal) =>
  cached<RawFact[]>(admin, `merimee|${city.toLowerCase()}`, async () => {
    const data = await fetchJson(
      `https://tabular-api.data.gouv.fr/api/resources/${MERIMEE_RESOURCE}/data/?Commune_forme_index__exact=${encodeURIComponent(city)}&page_size=200`,
      signal,
    );
    return (data?.data ?? [])
      .map((r: any) => {
        const c = String(r.coordonnees_au_format_WGS84 ?? "").split(",").map(Number);
        if (c.length !== 2 || !c.every(Number.isFinite)) return null;
        const titre = r.Titre_editorial_de_la_notice || r.Denomination_de_l_edifice;
        if (!titre) return null;
        const parts = [
          r.Siecle_de_la_campagne_principale_de_construction && `Construction : ${String(r.Siecle_de_la_campagne_principale_de_construction).replace(/;/g, ", ")}.`,
          r.Adresse_forme_editoriale && `Adresse : ${r.Adresse_forme_editoriale}.`,
          r.Date_et_typologie_de_la_protection && `Protection : ${String(r.Date_et_typologie_de_la_protection).replace(/;/g, ", ")}.`,
          r.Historique && String(r.Historique),
        ].filter(Boolean);
        return {
          titre,
          texte: clip(parts.join(" ")),
          source_label: "Monuments historiques (base Mérimée)",
          source_url: `https://pop.culture.gouv.fr/notice/merimee/${r.Reference}`,
          lat: c[0],
          lon: c[1],
          kind: "merimee" as const,
        };
      })
      .filter(Boolean) as RawFact[];
  });

// deno-lint-ignore no-explicit-any
const communePois = async (admin: any, postcode: string, cityLabel: string): Promise<RawFact[]> => {
  if (!admin || !postcode) return [];
  const { data } = await admin
    .from("commune_pois")
    .select("nom, description, lat, lon, url_source")
    .eq("code_postal", postcode)
    .eq("active", true)
    .limit(100);
  return (data ?? []).map((p: any) => ({
    titre: p.nom,
    texte: clip(p.description || p.nom),
    source_label: `Ville de ${cityLabel}`,
    source_url: p.url_source || null,
    lat: p.lat,
    lon: p.lon,
    kind: "commune" as const,
  }));
};

export type FactsResult = { facts: Fact[]; counts: Record<string, number>; errors: string[] };

export const collectFacts = async (opts: {
  // deno-lint-ignore no-explicit-any
  admin: any;
  route: LonLat[];
  steps: Pt[];
  postcode?: string;
  city?: string;
  timeoutMs?: number;
}): Promise<FactsResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  const errors: string[] = [];
  const guard = <T>(label: string, p: Promise<T[]>) =>
    p.catch((e) => { errors.push(`${label}: ${e?.message ?? e}`); return [] as T[]; });
  const deadline = new Promise<"timeout">((res) => setTimeout(() => res("timeout"), (opts.timeoutMs ?? 4000) + 100));

  const tasks: Promise<RawFact[]>[] = [
    guard("commune", communePois(opts.admin, opts.postcode ?? "", opts.city ?? "la commune")),
    ...opts.steps.map((s, i) => guard(`wikipedia#${i + 1}`, wikipediaAround(opts.admin, s, controller.signal))),
  ];
  if (opts.city) tasks.push(guard("merimee", merimeeForCity(opts.admin, opts.city, controller.signal)));

  const settled = await Promise.race([Promise.all(tasks), deadline]);
  clearTimeout(timer);
  const all: RawFact[] = settled === "timeout" ? [] : settled.flat();
  if (settled === "timeout") errors.push("timeout global");

  const seen = new Set<string>();
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const priority = { commune: 0, merimee: 1, wikipedia: 2 } as const;
  const kept = all
    .map((f) => ({ ...f, d: distToRoute({ lat: f.lat, lon: f.lon }, opts.route) }))
    .filter((f) => f.d <= MAX_DIST_M)
    .sort((a, b) => priority[a.kind] - priority[b.kind] || a.d - b.d)
    .filter((f) => {
      const k = norm(f.titre);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
  // Quotas pour garder un mélange de sources : commune d'abord, puis ≤ 6 Mérimée / ≤ 6 Wikipédia.
  const quota: Record<string, number> = { commune: MAX_FACTS, merimee: 6, wikipedia: 6 };
  const picked = kept.filter((f) => quota[f.kind]-- > 0).slice(0, MAX_FACTS);
  if (picked.length < MAX_FACTS) {
    for (const f of kept) if (picked.length < MAX_FACTS && !picked.includes(f)) picked.push(f);
  }
  picked.sort((a, b) => a.d - b.d);

  const facts: Fact[] = picked.map((f, i) => ({
    id: `F${i + 1}`,
    titre: f.titre,
    texte: f.texte,
    source_label: f.source_label,
    source_url: f.source_url,
    distance_m: Math.round(f.d),
    etape_la_plus_proche: nearestStep({ lat: f.lat, lon: f.lon }, opts.steps),
    kind: f.kind,
  }));
  const counts = { commune: 0, wikipedia: 0, merimee: 0 } as Record<string, number>;
  facts.forEach((f) => counts[f.kind]++);
  return { facts, counts, errors };
};

// ---------- Contrôle des éléments non sourcés ----------

export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, " ").replace(/\s+/g, " ");

const ROMAN = /\b[IVXLC]{1,6}(?:e|ème|ᵉ|er)?\b/g;
const NUMBER = /\b\d+(?:[.,]\d+)?\b/g;
const CAP_SEQ = /(?<![.!?:]\s)(?<!^)\b([A-ZÀ-ÖØ-Þ][\p{L}’'-]+(?:\s+(?:de|du|des|la|le|les|d’|d'|l’|l')?\s*[A-ZÀ-ÖØ-Þ][\p{L}’'-]+)*)/gu;
const ALWAYS_OK = ["monument historique", "monuments historiques", "merimee", "wikipedia", "ville", "mairie"];
const STOP_CAPS = new Set(["prudence", "attention", "ici", "au", "en", "ce", "cette", "le", "la", "les", "un", "une", "on", "vous", "a", "sur"]);

export const findUnsourced = (text: string, allowedCorpus: string): string[] => {
  const corpus = normalize(allowedCorpus) + " " + ALWAYS_OK.join(" ");
  const out = new Set<string>();
  for (const m of text.match(NUMBER) ?? []) if (!corpus.includes(normalize(m))) out.add(m);
  for (const m of text.match(ROMAN) ?? []) {
    const core = m.replace(/(e|ème|ᵉ|er)$/, "");
    if (core.length === 1 && !/[IVX]/.test(core)) continue;
    if (!corpus.includes(normalize(core))) out.add(m);
  }
  // sentences: ignore first word of each sentence
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const body = sentence.replace(/^\s*[«"(]?\s*\S+/, (w) => " ".repeat(w.length));
    for (const m of body.matchAll(/\b([A-ZÀ-ÖØ-Þ][\p{L}’'-]+(?:\s+(?:de|du|des|la|le|les|d’|d'|l’|l')?\s*[A-ZÀ-ÖØ-Þ][\p{L}’'-]+)*)/gu)) {
      const term = m[1];
      if (/^[IVXLC]+$/.test(term)) continue;
      if (STOP_CAPS.has(normalize(term))) continue;
      if (!corpus.includes(normalize(term))) out.add(term);
    }
  }
  return [...out];
};

export const stripSentencesWith = (text: string, bad: string[]) =>
  text
    .split(/(?<=[.!?…])\s+/)
    .filter((s) => !bad.some((b) => s.includes(b)))
    .join(" ")
    .trim();

void CAP_SEQ;
