#!/usr/bin/env python3
"""Génère les pages statiques « Balades à pied à <commune> » de microbalade.fr.

Sources (toutes publiques, sans clé) :
  - geo.api.gouv.fr      : liste des communes, population, centre, contour
  - data.gouv.fr (Mérimée) : immeubles protégés au titre des monuments historiques
  - fr.wikipedia.org     : lieux géolocalisés dans le contour de la commune + extraits

Règle éditoriale : aucun texte n'est inventé. Chaque lieu affiché cite sa source.
Une commune n'a de page que si elle compte au moins MIN_RICH lieux documentés.

Usage : python3 scripts/seo/build_commune_pages.py --dept 62 --max 150
Sorties : public/balades/<slug>.html, public/balades/<departement>.html,
          public/sitemap-balades.xml (déclaré dans public/robots.txt)
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

SITE = "https://microbalade.fr"
UA = "MicrobaladeSEO/1.0 (https://microbalade.fr; contact@microbalade.com)"
MERIMEE_RESOURCE = "3a52af4a-f9da-4dcc-8110-b07774dfb3bc"
MIN_RICH = 3          # lieux avec un texte sourcé d'au moins MIN_TEXT caractères
MIN_TEXT = 60
MAX_PLACES = 24       # lieux affichés par page
DEPT_NAMES = {"62": "Pas-de-Calais", "59": "Nord", "80": "Somme", "02": "Aisne", "60": "Oise"}

EXCLUDE_TITLE = re.compile(
    r"^(liste|canton|arrondissement|communauté|élections?|gare|bataille|siège|"
    r"combat|us |as |rc |fc |es |sc |club|stade|collège|lycée|école|autoroute|route|"
    r"ligne|diocèse|doyenné|paroisse|circonscription|intercommunalité|pays )",
    re.I,
)

# ---------------------------------------------------------------- utilitaires

def get_json(url: str, params: dict | None = None, retries: int = 4):
    if params:
        url = f"{url}{'&' if '?' in url else '?'}{urllib.parse.urlencode(params)}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                print(f"  ! échec {url[:120]} : {e}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower().replace("œ", "oe").replace("æ", "ae"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", slugify(s or ""))


def haversine(a, b) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def point_in_ring(lon, lat, ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def in_contour(lon, lat, contour) -> bool:
    if not contour:
        return True
    polys = contour["coordinates"] if contour["type"] == "MultiPolygon" else [contour["coordinates"]]
    for poly in polys:
        if point_in_ring(lon, lat, poly[0]) and not any(point_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


def cut(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if len(text) <= n:
        return text
    cutp = text.rfind(". ", 0, n)
    return text[: cutp + 1] if cutp > n * 0.5 else text[:n].rsplit(" ", 1)[0] + "…"


E = html.escape

# ---------------------------------------------------------------- collecte

def fetch_communes(dept: str):
    data = get_json(
        f"https://geo.api.gouv.fr/departements/{dept}/communes",
        {"fields": "nom,code,codesPostaux,population,centre,surface,contour,mairie", "format": "json", "geometry": "centre"},
    )
    return data or []


def fetch_merimee(dept: str):
    rows, page = [], 1
    while True:
        j = get_json(
            f"https://tabular-api.data.gouv.fr/api/resources/{MERIMEE_RESOURCE}/data/",
            {"Departement_format_numerique__exact": dept, "page_size": 50, "page": page},
        )
        if not j or not j.get("data"):
            break
        rows += j["data"]
        if len(j["data"]) < 50:
            break
        page += 1
        time.sleep(0.2)
    by_insee: dict[str, list] = {}
    for r in rows:
        insee = r.get("COG_Insee_lors_de_la_protection") or ""
        coord = r.get("coordonnees_au_format_WGS84") or ""
        if not insee or "," not in coord:
            continue
        lat, lon = (float(x) for x in coord.split(",")[:2])
        titre = r.get("Titre_editorial_de_la_notice") or r.get("Denomination_de_l_edifice") or "Monument"
        prot = r.get("Date_et_typologie_de_la_protection") or ""
        year = re.findall(r"(\d{4})/\d{2}/\d{2}", prot)
        typ = "classé" if "classé" in prot else ("inscrit" if "inscrit" in prot else "protégé")
        parts = []
        denom = r.get("Denomination_de_l_edifice")
        siecle = r.get("Siecle_de_la_campagne_principale_de_construction") or r.get("Format_abrege_du_siecle_de_construction")
        if denom and norm(denom) not in norm(titre):
            parts.append(denom.capitalize())
        if siecle:
            parts.append(f"construction principale : {siecle}")
        head = ", ".join(parts)
        text = (head + ". " if head else "") + (
            f"{typ.capitalize()} au titre des monuments historiques" + (f" en {min(year)}." if year else ".")
        )
        hist = cut(r.get("Historique") or "", 380)
        if hist:
            text += " " + hist
        by_insee.setdefault(insee, []).append({
            "nom": titre,
            "lat": lat, "lon": lon,
            "texte": text,
            "source": "Base Mérimée (ministère de la Culture)",
            "url": f"https://pop.culture.gouv.fr/notice/merimee/{r.get('Reference')}",
            "type": "Monument historique",
            "classe": typ == "classé",
            "has_hist": bool(hist),
        })
    return by_insee


def fetch_wikipedia(commune, radius_m: int):
    lat, lon = commune["centre"]["coordinates"][1], commune["centre"]["coordinates"][0]
    j = get_json("https://fr.wikipedia.org/w/api.php", {
        "action": "query", "list": "geosearch", "gscoord": f"{lat}|{lon}",
        "gsradius": min(10000, radius_m), "gslimit": 60, "format": "json",
    })
    hits = (j or {}).get("query", {}).get("geosearch", [])
    name_n = norm(commune["nom"])
    hits = [
        h for h in hits
        if norm(h["title"]) != name_n
        and not EXCLUDE_TITLE.search(h["title"])
        and in_contour(h["lon"], h["lat"], commune.get("contour"))
    ]
    places = []
    for i in range(0, len(hits), 20):
        chunk = hits[i:i + 20]
        ex = get_json("https://fr.wikipedia.org/w/api.php", {
            "action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1,
            "exsentences": 3, "exlimit": 20, "format": "json",
            "pageids": "|".join(str(h["pageid"]) for h in chunk),
        })
        pages = (ex or {}).get("query", {}).get("pages", {})
        for h in chunk:
            p = pages.get(str(h["pageid"]), {})
            txt = cut(p.get("extract") or "", 420)
            if len(txt) < MIN_TEXT or "peut faire référence" in txt:
                continue
            places.append({
                "nom": h["title"], "lat": h["lat"], "lon": h["lon"], "texte": txt,
                "source": "Wikipédia", "url": f"https://fr.wikipedia.org/?curid={h['pageid']}",
                "type": "Lieu", "classe": False, "has_hist": True,
            })
        time.sleep(0.3)
    return places


def fetch_mairie(commune):
    """Position de la mairie (champ « mairie » de geo.api.gouv.fr), sinon centre de la commune."""
    pt = (commune.get("mairie") or {}).get("coordinates") or commune["centre"]["coordinates"]
    label = f"Mairie, {commune['nom']}" if commune.get("mairie") else commune["nom"]
    return pt[1], pt[0], label


def merge_places(mh, wiki):
    """Rattache un article Wikipédia au monument correspondant plutôt que de le dupliquer."""
    out = list(mh)
    for w in wiki:
        twin = next((m for m in out if m["source"].startswith("Base Mérimée")
                     and (norm(m["nom"]) in norm(w["nom"]) or norm(w["nom"]) in norm(m["nom"]))
                     and len(norm(m["nom"])) > 6 and haversine((m["lat"], m["lon"]), (w["lat"], w["lon"])) < 400), None)
        if twin:
            twin["wiki"] = {"texte": w["texte"], "url": w["url"]}
            twin["has_hist"] = True
        else:
            out.append(w)
    return out


def richness(p) -> bool:
    txt = p["texte"] + (p.get("wiki") or {}).get("texte", "")
    return len(txt) >= MIN_TEXT and (p["has_hist"] or p.get("wiki") or not re.fullmatch(r"maison|immeuble|ferme", norm(p["nom"])))


# ---------------------------------------------------------------- rendu

CSS = """
:root{--o:#E8622A;--bg:#FAF8F5;--ink:#1b1b1b;--mut:#6b6b6b;--card:#fff;--line:#ece7e1}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55}
a{color:var(--o)}.wrap{max-width:860px;margin:0 auto;padding:0 16px}
header{padding:14px 0;border-bottom:1px solid var(--line);background:#fff}header .wrap{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:900;font-size:20px;text-decoration:none;color:var(--ink)}.logo span{color:var(--o)}
nav.crumbs{font-size:13px;color:var(--mut);margin:18px 0 6px}nav.crumbs a{color:var(--mut)}
h1{font-size:clamp(28px,5vw,40px);font-weight:900;line-height:1.15;margin:6px 0 10px}
.lead{font-size:17px;color:#333;margin:0 0 20px}
.cta{display:inline-block;background:var(--o);color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:14px;box-shadow:0 8px 20px rgba(232,98,42,.25)}
.cta2{display:inline-block;margin-left:10px;font-weight:600;text-decoration:none}
#map{height:320px;border-radius:18px;margin:26px 0;border:1px solid var(--line)}
h2{font-size:22px;margin:34px 0 12px}
.place{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:0 0 12px}
.place h3{margin:0 0 4px;font-size:17px}.tag{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--o);background:#fdeee7;border-radius:999px;padding:2px 8px;margin-bottom:6px}
.place p{margin:6px 0;font-size:15px}.src{font-size:12.5px;color:var(--mut)}.src a{color:var(--mut)}
.box{background:#fff;border:2px solid var(--o);border-radius:18px;padding:18px 20px;margin:34px 0}
.near a{display:inline-block;margin:0 8px 8px 0;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;text-decoration:none;color:var(--ink);font-size:14px}
footer{margin:40px 0 0;padding:24px 0;border-top:1px solid var(--line);font-size:13px;color:var(--mut)}
@media(max-width:560px){.cta2{display:block;margin:12px 0 0}}
"""

HEAD_LINKS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">'
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">'
)


def page_shell(title, desc, canonical, body, jsonld, extra_head=""):
    return f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)}</title><meta name="description" content="{E(desc)}"><link rel="canonical" href="{canonical}">
<meta property="og:type" content="website"><meta property="og:title" content="{E(title)}"><meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{canonical}"><meta property="og:site_name" content="Microbalade"><meta property="og:locale" content="fr_FR">
<link rel="icon" href="/favicon.ico">{HEAD_LINKS}{extra_head}<style>{CSS}</style>
<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script></head>
<body><header><div class="wrap"><a class="logo" href="/">Micro<span>balade</span></a><a href="/partenaires">Partenaires</a></div></header>
<main class="wrap">{body}</main>
<footer><div class="wrap">Textes issus de la base Mérimée (ministère de la Culture) et de Wikipédia (licence CC BY-SA), cités lieu par lieu. Fond de carte © contributeurs OpenStreetMap.
Une erreur ? <a href="/contact">Signalez-la</a>. · <a href="/confidentialite">Confidentialité</a> · <a href="/mentions-legales">Mentions légales</a></div></footer>
</body></html>
"""


def render_commune(c, places, start, neighbors, dept_name, dept_slug, partner_slug):
    nom = c["nom"]
    url = f"{SITE}/balades/{c['slug']}.html"
    n = len(places)
    n_mh = sum(1 for p in places if p["source"].startswith("Base Mérimée"))
    title = f"Balades à pied à {nom} : {n} lieux du patrimoine | Microbalade"
    if len(title) > 70:
        title = f"Balades à pied à {nom} | Microbalade"
    desc = (f"{n} lieux à découvrir à pied à {nom} ({dept_name})"
            + (f", dont {n_mh} monuments historiques" if n_mh else "")
            + ". Créez une balade de 15 min à 2 h depuis la mairie, textes sourcés.")
    lat, lon, label = start
    if partner_slug:
        cta_url = f"/{partner_slug}"
    else:
        cta_url = "/?" + urllib.parse.urlencode({"lat": f"{lat:.5f}", "lon": f"{lon:.5f}", "depart": label, "src": "seo"})
    cards = []
    for p in places:
        wiki = p.get("wiki")
        src = f'Source : <a href="{E(p["url"])}" rel="nofollow noopener" target="_blank">{E(p["source"])}</a>'
        if wiki:
            src += f' · <a href="{E(wiki["url"])}" rel="nofollow noopener" target="_blank">Wikipédia</a>'
        tag = "Monument historique classé" if p["classe"] else p["type"]
        body = f"<p>{E(p['texte'])}</p>" + (f"<p>{E(wiki['texte'])}</p>" if wiki else "")
        cards.append(f'<article class="place"><span class="tag">{E(tag)}</span><h3>{E(p["nom"])}</h3>{body}<p class="src">{src}</p></article>')
    near = "".join(f'<a href="/balades/{E(x["slug"])}.html">{E(x["nom"])}</a>' for x in neighbors)
    pts = [[round(p["lat"], 5), round(p["lon"], 5), p["nom"]] for p in places]
    body = f"""
<nav class="crumbs"><a href="/">Accueil</a> › <a href="/balades/{dept_slug}.html">Balades dans le {E(dept_name)}</a> › {E(nom)}</nav>
<h1>Balades à pied à {E(nom)}</h1>
<p class="lead">{n} lieux documentés à voir en marchant{f", dont {n_mh} protégés au titre des monuments historiques" if n_mh else ""}. Microbalade trace pour vous une boucle de 15&nbsp;min à 2&nbsp;h qui passe près de ces lieux, avec leur histoire racontée à partir de sources vérifiables.</p>
<a class="cta" href="{E(cta_url)}">Créer ma balade depuis {E(label)}</a>
<div id="map" role="img" aria-label="Carte des lieux à découvrir à {E(nom)}"></div>
<h2>Les lieux à découvrir à {E(nom)}</h2>
{''.join(cards)}
<div class="box"><strong>Vous êtes élu ou agent à {E(nom)} ?</strong><p style="margin:6px 0 10px">Ajoutez vos propres lieux et textes validés, votre logo, et un QR code à afficher en ville. Vous suivez ensuite combien de balades sont faites sur votre commune.</p><a href="/partenaires/pilote">Demander un pilote gratuit de 3 mois</a> · <a class="cta2" href="/partenaires">Voir les offres</a></div>
{f'<h2>Balades dans les communes voisines</h2><div class="near">{near}</div>' if near else ''}
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>(function(){{var p={json.dumps(pts, ensure_ascii=False)};var m=L.map('map',{{scrollWheelZoom:false}});
L.tileLayer('https://tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png',{{maxZoom:18,attribution:'&copy; OpenStreetMap'}}).addTo(m);
var b=[];p.forEach(function(x){{L.circleMarker([x[0],x[1]],{{radius:7,color:'#fff',weight:2,fillColor:'#E8622A',fillOpacity:1}}).addTo(m).bindPopup(x[2].replace(/</g,'&lt;'));b.push([x[0],x[1]]);}});
L.marker([{lat:.5f},{lon:.5f}]).addTo(m).bindPopup('Départ proposé');b.push([{lat:.5f},{lon:.5f}]);m.fitBounds(b,{{padding:[24,24],maxZoom:15}});}})();</script>
"""
    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Accueil", "item": SITE + "/"},
                {"@type": "ListItem", "position": 2, "name": f"Balades dans le {dept_name}", "item": f"{SITE}/balades/{dept_slug}.html"},
                {"@type": "ListItem", "position": 3, "name": nom, "item": url}]},
            {"@type": "ItemList", "name": f"Lieux à découvrir à pied à {nom}", "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "item": {
                    "@type": "TouristAttraction", "name": p["nom"],
                    "geo": {"@type": "GeoCoordinates", "latitude": round(p["lat"], 5), "longitude": round(p["lon"], 5)},
                    "address": {"@type": "PostalAddress", "addressLocality": nom, "postalCode": (c.get("codesPostaux") or [""])[0], "addressCountry": "FR"},
                    "sameAs": p["url"]}} for i, p in enumerate(places)]},
        ],
    }
    return page_shell(title, desc, url, body, jsonld)


def render_hub(dept_name, dept_slug, pages):
    url = f"{SITE}/balades/{dept_slug}.html"
    items = "".join(
        f'<a href="/balades/{E(p["slug"])}.html">{E(p["nom"])} <span style="color:#6b6b6b">· {p["n"]} lieux</span></a>'
        for p in sorted(pages, key=lambda x: x["nom"])
    )
    body = f"""<nav class="crumbs"><a href="/">Accueil</a> › Balades dans le {E(dept_name)}</nav>
<h1>Balades à pied dans le {E(dept_name)}</h1>
<p class="lead">{len(pages)} communes où découvrir à pied des lieux documentés : monuments historiques, églises, sites de mémoire, patrimoine industriel. Choisissez une commune, puis laissez Microbalade tracer votre boucle.</p>
<div class="near">{items}</div>"""
    jsonld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": f"Balades à pied dans le {dept_name}", "url": url}
    return page_shell(f"Balades à pied dans le {dept_name} | Microbalade",
                      f"{len(pages)} communes du {dept_name} à découvrir à pied, avec des lieux documentés et des balades de 15 min à 2 h.",
                      url, body, jsonld)


def partner_slugs(supabase_url: str | None, anon: str | None):
    """Communes partenaires actives (page /<slug>) : on renvoie vers leur page plutôt que vers l'accueil."""
    if not supabase_url or not anon:
        return {}
    try:
        req = urllib.request.Request(
            f"{supabase_url}/rest/v1/communes_partenaires?select=slug,code_postal,nom&active=eq.true",
            headers={"apikey": anon, "Authorization": f"Bearer {anon}", "User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.load(r)
        return {norm(x["nom"]): x["slug"] for x in rows if x.get("slug")}
    except Exception as e:  # noqa: BLE001
        print(f"  ! partenaires indisponibles : {e}", file=sys.stderr)
        return {}


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dept", default="62")
    ap.add_argument("--max", type=int, default=150, help="nombre maximum de pages")
    ap.add_argument("--min-pop", type=int, default=1500, help="population minimale sans monument historique")
    ap.add_argument("--out", default="public")
    args = ap.parse_args()

    dept = args.dept
    dept_name = DEPT_NAMES.get(dept, f"département {dept}")
    dept_slug = slugify(dept_name)
    out_dir = os.path.join(args.out, "balades")
    os.makedirs(out_dir, exist_ok=True)

    print(f"Communes du {dept_name}…")
    communes = fetch_communes(dept)
    print(f"  {len(communes)} communes")
    print("Monuments historiques (Mérimée)…")
    mh = fetch_merimee(dept)
    print(f"  {sum(len(v) for v in mh.values())} monuments géolocalisés dans {len(mh)} communes")

    candidates = [c for c in communes if c["code"] in mh or (c.get("population") or 0) >= args.min_pop]
    print(f"Candidates : {len(candidates)}")
    partners = partner_slugs(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_ANON_KEY"))

    built = []
    for i, c in enumerate(sorted(candidates, key=lambda x: -(x.get("population") or 0))):
        c["slug"] = slugify(c["nom"])
        surface_m2 = (c.get("surface") or 1000) * 10000
        radius = int(max(1500, min(10000, math.sqrt(surface_m2 / math.pi) * 1.3)))
        wiki = fetch_wikipedia(c, radius)
        places = merge_places(mh.get(c["code"], []), wiki)
        rich = [p for p in places if richness(p)]
        # tri : monuments classés, puis lieux avec histoire, puis le reste
        rich.sort(key=lambda p: (not p["classe"], not (p["has_hist"] or p.get("wiki")), p["nom"]))
        print(f"[{i + 1}/{len(candidates)}] {c['nom']}: {len(places)} lieux, {len(rich)} documentés")
        if len(rich) < MIN_RICH:
            continue
        c["places"] = rich[:MAX_PLACES]
        c["start"] = fetch_mairie(c)
        built.append(c)

    built.sort(key=lambda c: -len(c["places"]))
    built = built[: args.max]
    keep = {c["slug"] for c in built}

    for c in built:
        here = (c["centre"]["coordinates"][1], c["centre"]["coordinates"][0])
        neighbors = sorted(
            (x for x in built if x["slug"] != c["slug"]),
            key=lambda x: haversine(here, (x["centre"]["coordinates"][1], x["centre"]["coordinates"][0])),
        )[:8]
        html_doc = render_commune(c, c["places"], c["start"], neighbors, dept_name, dept_slug,
                                  partners.get(norm(c["nom"])))
        with open(os.path.join(out_dir, f"{c['slug']}.html"), "w", encoding="utf-8") as f:
            f.write(html_doc)

    # supprime les pages de communes qui ne passent plus le seuil
    for fn in os.listdir(out_dir):
        if fn.endswith(".html") and fn[:-5] not in keep and fn[:-5] != dept_slug:
            os.remove(os.path.join(out_dir, fn))

    with open(os.path.join(out_dir, f"{dept_slug}.html"), "w", encoding="utf-8") as f:
        f.write(render_hub(dept_name, dept_slug, [{"slug": c["slug"], "nom": c["nom"], "n": len(c["places"])} for c in built]))

    today = dt.date.today().isoformat()
    urls = [f"{SITE}/balades/{dept_slug}.html"] + [f"{SITE}/balades/{c['slug']}.html" for c in built]
    with open(os.path.join(args.out, "sitemap-balades.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for u in urls:
            f.write(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq></url>\n")
        f.write("</urlset>\n")

    robots = os.path.join(args.out, "robots.txt")
    if os.path.exists(robots):
        txt = open(robots, encoding="utf-8").read()
        line = f"Sitemap: {SITE}/sitemap-balades.xml"
        if line not in txt:
            with open(robots, "a", encoding="utf-8") as f:
                f.write(("\n" if not txt.endswith("\n") else "") + line + "\n")

    print(f"\n{len(built)} pages générées dans {out_dir} (+ page {dept_slug}.html et sitemap-balades.xml)")
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f"report-{dept}.json"), "w", encoding="utf-8") as f:
        json.dump([{"commune": c["nom"], "lieux": len(c["places"]),
                    "mh": sum(1 for p in c["places"] if p["source"].startswith("Base"))} for c in built],
                  f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
