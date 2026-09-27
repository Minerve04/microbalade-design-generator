import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import HomeScreen, { type CommunePageData } from "@/components/HomeScreen";
import ResultScreen, { BaladeResult } from "@/components/ResultScreen";
import { supabase } from "@/integrations/supabase/client";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

const Index = () => {
  const { slug: rawSlug } = useParams();
  const slug = rawSlug?.toLowerCase() ?? null;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isQr = searchParams.get("src") === "qr";

  const [result, setResult] = useState<BaladeResult | null>(null);
  const [duration, setDuration] = useState(30);
  const [loading, setLoading] = useState(false);
  const [commune, setCommune] = useState<CommunePageData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [initialLocation, setInitialLocation] = useState<{ label: string; lat: number; lon: number } | null>(null);

  // Redirect legacy QR codes: /?source=qr&commune=…&cp=… → /<slug>?src=qr
  useEffect(() => {
    if (slug) return;
    const legacy = searchParams.get("commune");
    if (searchParams.get("source") !== "qr" || !legacy) return;
    (async () => {
      const { data } = await supabase.rpc("resolve_legacy_commune", {
        p_commune: legacy,
        p_cp: searchParams.get("cp") ?? "",
      });
      if (typeof data === "string" && data) navigate(`/${data}?src=qr`, { replace: true });
    })();
  }, [slug, searchParams, navigate]);

  // Load town page
  useEffect(() => {
    setCommune(null);
    setNotice(null);
    setInitialLocation(null);
    if (!slug) {
      // Point de départ transmis par les pages « Balades à pied à … » (/?lat=…&lon=…&depart=…)
      const lat = Number(searchParams.get("lat"));
      const lon = Number(searchParams.get("lon"));
      const label = (searchParams.get("depart") ?? "").slice(0, 120).trim();
      if (label && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
        setInitialLocation({ label, lat, lon });
      }
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setNotice("Cette commune n'est pas encore partenaire.");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_commune_page", { p_slug: slug });
      if (cancelled) return;
      const page = data as unknown as CommunePageData | null;
      if (!page?.slug) {
        setNotice("Cette commune n'est pas encore partenaire.");
        return;
      }
      // Display name: capitalise if the town typed it in lowercase
      if (page.nom === page.nom.toLowerCase()) {
        page.nom = page.nom.replace(/(^|[\s-])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
      }
      setCommune(page);

      // One visit per browser session and per town
      const key = `mb-visit-${page.slug}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        supabase.functions
          .invoke("log-visit", { body: { slug: page.slug, source: isQr ? "qr" : "page" } })
          .catch(() => {});
      }

      // Town centre as default start point
      try {
        const q = new URLSearchParams({ nom: page.nom, fields: "nom,centre,mairie,codesPostaux", boost: "population", limit: "1" });
        if (page.code_postal) q.set("codePostal", page.code_postal);
        const r = await fetch(`https://geo.api.gouv.fr/communes?${q}`);
        const list = await r.json();
        const c = list?.[0];
        const pt = c?.mairie?.coordinates ?? c?.centre?.coordinates;
        if (!cancelled && pt) {
          const cp = page.code_postal || c.codesPostaux?.[0] || "";
          setInitialLocation({
            label: `Mairie, ${c.nom}${cp ? ` ${cp}` : ""}`,
            lon: pt[0],
            lat: pt[1],
          });
        }
      } catch {
        /* user can still type an address */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const handleGenerate = async (data: { location: string; duration: number; interests: string[]; lat?: number; lon?: number }) => {
    if (!data.location.trim()) {
      toast.error("Veuillez indiquer votre localisation");
      return;
    }
    if (data.interests.length === 0) {
      toast.error("Choisissez au moins un centre d'intérêt");
      return;
    }

    setDuration(data.duration);
    setLoading(true);

    try {
      const { data: fnData, error } = await supabase.functions.invoke("generate-balade", {
        body: {
          location: data.location,
          duration: data.duration,
          interests: data.interests,
          ...(data.lat !== undefined && data.lon !== undefined ? { lat: data.lat, lon: data.lon } : {}),
          source: commune ? (isQr ? "qr" : "page") : "direct",
          ...(commune ? { commune_slug: commune.slug } : {}),
        },
      });

      if (error) throw error;
      if (fnData?.error) throw new Error(fnData.error);

      setResult(fnData as BaladeResult);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Erreur lors de la génération");
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return <ResultScreen result={result} duration={duration} onBack={() => setResult(null)} />;
  }

  return (
    <HomeScreen
      onGenerate={handleGenerate}
      loading={loading}
      commune={commune}
      initialLocation={initialLocation}
      notice={notice}
    />
  );
};

export default Index;
