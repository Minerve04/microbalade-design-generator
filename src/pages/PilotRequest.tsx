import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, Loader2, CheckCircle2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const FONCTIONS = [
  "Élu(e)",
  "DGS",
  "Office de tourisme",
  "Chef de projet Petites Villes de Demain / Action Cœur de Ville",
  "Autre",
];

type GeoCommune = { nom: string; population?: number; codesPostaux?: string[] };

const inputCls =
  "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function PilotRequest() {
  const [communeQuery, setCommuneQuery] = useState("");
  const [commune, setCommune] = useState<{ nom: string; code_postal: string | null; population: number | null } | null>(null);
  const [suggestions, setSuggestions] = useState<GeoCommune[]>([]);
  const [form, setForm] = useState({ contact_nom: "", fonction: "", email: "", telephone: "", message: "", website: "" });
  const [rgpd, setRgpd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const q = communeQuery.trim();
    if (q.length < 2 || commune?.nom === q) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,population,codesPostaux&boost=population&limit=5`,
          { signal: ctrl.signal }
        );
        setSuggestions(await r.json());
      } catch {
        /* ignore */
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [communeQuery, commune]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nom = commune?.nom ?? communeQuery.trim();
    if (!nom || !form.contact_nom.trim() || !form.fonction || !form.email.trim()) {
      toast.error("Merci de renseigner les champs obligatoires.");
      return;
    }
    if (!rgpd) {
      toast.error("Merci d'accepter le traitement de vos données.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-pilot-request", {
        body: {
          commune_nom: nom,
          code_postal: commune?.code_postal ?? null,
          population: commune?.population ?? null,
          ...form,
          telephone: form.telephone || null,
          message: form.message || null,
          rgpd: true,
        },
      });
      if (error) {
        const body = await (error as any)?.context?.response?.clone?.().json?.().catch(() => null);
        throw new Error(body?.error || "Envoi impossible, réessayez plus tard.");
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      setSent(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-5 py-8">
      <Helmet>
        <title>Demander un pilote gratuit de 3 mois — Microbalade</title>
        <meta name="description" content="Testez Microbalade gratuitement pendant 3 mois dans votre commune : QR code, page dédiée, statistiques." />
      </Helmet>
      <div className="max-w-xl mx-auto space-y-6">
        <Link to="/partenaires" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Retour aux offres
        </Link>
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-foreground">Demander un pilote gratuit de 3 mois</h1>
          <p className="text-muted-foreground">
            Testez Microbalade dans votre commune sans engagement : page dédiée, QR code, statistiques. Nous revenons vers vous sous 48 h.
          </p>
        </div>

        {sent ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-3">
            <CheckCircle2 className="mx-auto text-primary" size={40} />
            <h2 className="text-xl font-bold text-foreground">Demande envoyée</h2>
            <p className="text-sm text-muted-foreground">Merci ! Un email de confirmation vient de vous être envoyé. Nous revenons vers vous sous 48 h.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="relative">
              <label className="text-sm font-medium text-foreground">Commune *</label>
              <div className="relative mt-1">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" size={16} />
                <input
                  className={`${inputCls} pl-9`}
                  value={communeQuery}
                  onChange={(e) => {
                    setCommuneQuery(e.target.value);
                    setCommune(null);
                  }}
                  placeholder="Rechercher ma commune"
                  autoComplete="off"
                />
              </div>
              {suggestions.length > 0 && (
                <ul className="absolute z-40 mt-1 w-full bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                  {suggestions.map((c) => (
                    <li key={`${c.nom}-${c.codesPostaux?.[0]}`}>
                      <button
                        type="button"
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted"
                        onClick={() => {
                          setCommune({ nom: c.nom, code_postal: c.codesPostaux?.[0] ?? null, population: c.population ?? null });
                          setCommuneQuery(c.nom);
                          setSuggestions([]);
                        }}
                      >
                        <span className="font-medium">{c.nom}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          {c.codesPostaux?.[0]} {c.population ? `· ${c.population.toLocaleString("fr-FR")} hab.` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Nom *</label>
              <input className={`${inputCls} mt-1`} value={form.contact_nom} onChange={(e) => setForm({ ...form, contact_nom: e.target.value })} maxLength={120} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Fonction *</label>
              <select className={`${inputCls} mt-1`} value={form.fonction} onChange={(e) => setForm({ ...form, fonction: e.target.value })}>
                <option value="">Choisir…</option>
                {FONCTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Email professionnel *</label>
              <input type="email" className={`${inputCls} mt-1`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={200} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Téléphone</label>
              <input type="tel" className={`${inputCls} mt-1`} value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} maxLength={30} />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Message</label>
              <textarea rows={4} className={`${inputCls} mt-1`} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={3000} />
            </div>
            {/* Honeypot — hidden from humans */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>
                Site web
                <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </label>
            </div>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="mt-0.5" checked={rgpd} onChange={(e) => setRgpd(e.target.checked)} />
              <span>
                J'accepte que Microbalade utilise ces informations pour me recontacter au sujet du pilote. Voir la{" "}
                <Link to="/confidentialite" className="underline">politique de confidentialité</Link>.
              </span>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl shadow-lg shadow-primary/25 disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />} Envoyer ma demande
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
