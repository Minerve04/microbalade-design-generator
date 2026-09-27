import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  LayoutDashboard,
  BarChart3,
  Settings,
  UserCircle2,
  LogOut,
  Download,
  Upload,
  Loader2,
  Menu,
  X,
  Footprints,
  Clock,
  TrendingUp,
  FileText,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCommuneSubscription } from "@/hooks/useCommuneSubscription";
import { AlertTriangle, Lock, FileText as FileTextIcon } from "lucide-react";
import { getStripeEnvironment, getCommunePriceIdFromAmount, COMMUNE_TIERS, VALID_PRICE_IDS } from "@/lib/stripe";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChorusRequestDialog } from "@/components/ChorusRequestDialog";
import logo from "@/assets/logo.png";
import CommuneQrCode from "@/components/CommuneQrCode";
import { QrCode, MapPinned } from "lucide-react";
import CommunePois from "@/components/CommunePois";

type TabKey = "overview" | "stats" | "config" | "pois" | "qrcode" | "profile";

interface CommuneProfile {
  id: string;
  user_id: string;
  email: string;
  nom_collectivite: string;
  code_postal: string | null;
  logo_url: string | null;
  lien_action: string | null;
  abonnement_label: string;
  abonnement_prix_annuel: number;
  abonnement_renouvellement: string;
  siret?: string | null;
  numero_engagement?: string | null;
  code_service_chorus?: string | null;
  adresse_facturation?: string | null;
  email_comptabilite?: string | null;
  mode_paiement?: string | null;
  chorus_status?: string | null;
  chorus_requested_at?: string | null;
  chorus_due_date?: string | null;
}

interface SearchRow {
  id: string;
  created_at: string;
  ville: string | null;
  origin_address: string | null;
  duree_minutes: number | null;
  themes: string[] | null;
  monuments: string[] | null;
}

const NAV: { key: TabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { key: "stats", label: "Données & Statistiques", icon: BarChart3 },
  { key: "config", label: "Configuration", icon: Settings },
  { key: "pois", label: "Mes lieux", icon: MapPinned },
  { key: "qrcode", label: "QR code", icon: QrCode },
  { key: "profile", label: "Profil & Facturation", icon: UserCircle2 },
];

// Subscriptions and invoices are managed through the Stripe Customer Portal.

const MONTHS_FR = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function lookupPostcode(nom: string): Promise<string | null> {
  const r = await fetch(
    `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nom)}&fields=codesPostaux&boost=population&limit=1`
  );
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr[0]?.codesPostaux?.[0] ? String(arr[0].codesPostaux[0]) : null;
}

export default function CommuneDashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isActive, status, isPendingMandat, loading: loadingSub } = useCommuneSubscription();
  const [tab, setTab] = useState<TabKey>("overview");
  // "locked" : abonnement cassé (impayé, annulé…) — pas pour un compte jamais payé.
  const locked = !loadingSub && !isActive && status !== "trialing" && status !== "incomplete";
  const neverPaid = !loadingSub && (status === "trialing" || status === "incomplete");
  const { openCheckout, closeCheckout, isOpen: checkoutOpen, checkoutElement } = useStripeCheckout();
  const [chorusOpen, setChorusOpen] = useState(false);

  const handlePay = (forcedPriceId?: string) => {
    const amount = profile?.abonnement_prix_annuel ?? 600;
    const priceId = forcedPriceId ?? getCommunePriceIdFromAmount(amount);
    openCheckout({
      priceId,
      returnUrl: `${window.location.origin}/dashboard/commune?checkout=success`,
    });
  };

  const [changingTier, setChangingTier] = useState(false);
  const changeTier = async (priceId: string) => {
    setChangingTier(true);
    const { error } = await supabase.rpc("set_pending_tier", { p_lookup_key: priceId });
    if (error) {
      toast.error(error.message);
    } else {
      const t = COMMUNE_TIERS.find((x) => x.priceId === priceId);
      if (t && profile) {
        setProfile({ ...profile, abonnement_prix_annuel: t.amountEur, abonnement_label: `Abonnement ${t.label.split(" (")[0]}` });
      }
      toast.success("Formule mise à jour");
    }
    setChangingTier(false);
  };

  // Force user onto billing tab only when subscription is broken
  useEffect(() => {
    if (locked && tab !== "profile") setTab("profile");
  }, [locked, tab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profile, setProfile] = useState<CommuneProfile | null>(null);
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Date filter (default = last 6 months)
  const today = useMemo(() => new Date(), []);
  const sixMonthsAgo = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    d.setDate(1);
    return d;
  }, []);
  const [from, setFrom] = useState<string>(toInputDate(sixMonthsAgo));
  const [to, setTo] = useState<string>(toInputDate(today));

  // Trafic page commune + scans QR (période sélectionnée)
  const [traffic, setTraffic] = useState<{ slug: string | null; qr_scans?: number; page_visits?: number; qr_balades?: number } | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_my_commune_traffic", {
        p_from: new Date(`${from}T00:00:00`).toISOString(),
        p_to: new Date(`${to}T23:59:59`).toISOString(),
      });
      if (!cancelled) setTraffic((data as any) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, from, to]);
  const qrRate =
    traffic?.qr_scans ? Math.round(((traffic.qr_balades ?? 0) / traffic.qr_scans) * 100) : null;

  // Form state
  const [lienAction, setLienAction] = useState("");
  const [codePostal, setCodePostal] = useState("");

  // Palier en attente (choisi sur /partenaires) : ouvrir directement le paiement au bon palier.
  const autoPayDone = useRef(false);
  useEffect(() => {
    if (autoPayDone.current || !profile || loadingSub || !neverPaid) return;
    const qp = new URLSearchParams(window.location.search).get("pay");
    const pending = qp || sessionStorage.getItem("pendingCheckoutPriceId");
    if (!pending || !VALID_PRICE_IDS.includes(pending) || pending === "commune_metropole_xl_year") return;
    autoPayDone.current = true;
    sessionStorage.removeItem("pendingCheckoutPriceId");
    sessionStorage.removeItem("pendingCommune");
    (async () => {
      if (getCommunePriceIdFromAmount(profile.abonnement_prix_annuel) !== pending) await changeTier(pending);
      setTab("profile");
      handlePay(pending);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, loadingSub, neverPaid]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("commune_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) {
        toast.error("Impossible de charger votre profil");
      } else if (data) {
        setProfile(data as CommuneProfile);
        setLienAction(data.lien_action ?? "");
        setCodePostal(data.code_postal ?? "");
        // Auto-fill code postal via geo.api.gouv.fr si vide
        if (!data.code_postal && data.nom_collectivite) {
          const cleanName = data.nom_collectivite.replace(/^(mairie|commune|ville)\s+(de\s+|du\s+|des\s+|d')?/i, "").trim();
          try {
            const postcode = await lookupPostcode(cleanName);
            if (postcode) {
              setCodePostal(postcode);
              await supabase
                .from("commune_profiles")
                .update({ code_postal: postcode })
                .eq("user_id", user.id);
              setProfile({ ...(data as CommuneProfile), code_postal: postcode });
            }
          } catch (e) {
            console.warn("Postcode auto-fill failed", e);
          }
        }
      }
      setLoadingProfile(false);
    })();
  }, [user]);

  const detectCodePostal = async () => {
    if (!profile?.nom_collectivite) return;
    const cleanName = profile.nom_collectivite.replace(/^(mairie|commune|ville)\s+(de\s+|du\s+|des\s+|d')?/i, "").trim();
    try {
      const postcode = await lookupPostcode(cleanName);
      if (postcode) {
        setCodePostal(postcode);
        toast.success(`Code postal détecté : ${postcode}`);
      } else {
        toast.error("Code postal introuvable, merci de le saisir manuellement");
      }
    } catch {
      toast.error("Détection impossible");
    }
  };

  useEffect(() => {
    if (!profile?.code_postal) {
      setSearches([]);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("statistiques_recherches")
        .select("id, created_at, ville, origin_address, duree_minutes, themes, monuments")
        .eq("code_postal", profile.code_postal)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (data) setSearches(data as SearchRow[]);
    })();
  }, [profile?.code_postal]);

  // Filtered dataset
  const filtered = useMemo(() => {
    const fromTs = new Date(from + "T00:00:00").getTime();
    const toTs = new Date(to + "T23:59:59").getTime();
    return searches.filter((s) => {
      const t = new Date(s.created_at).getTime();
      return t >= fromTs && t <= toTs;
    });
  }, [searches, from, to]);

  // Monthly aggregation for chart
  const monthlyData = useMemo(() => {
    const map = new Map<string, { key: string; label: string; balades: number; sort: number }>();
    filtered.forEach((s) => {
      const d = new Date(s.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      const label = `${MONTHS_FR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
      const sort = d.getFullYear() * 12 + d.getMonth();
      const existing = map.get(key);
      if (existing) existing.balades += 1;
      else map.set(key, { key, label, balades: 1, sort });
    });
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
  }, [filtered]);

  const totalBalades = filtered.length;
  const avgDuration = useMemo(() => {
    const arr = filtered.map((s) => s.duree_minutes ?? 0).filter(Boolean);
    if (!arr.length) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }, [filtered]);

  // Top monuments (unnest)
  const topMonuments = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((s) =>
      (s.monuments ?? []).forEach((m) => {
        const k = m.trim();
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      })
    );
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filtered]);

  // Duration buckets
  const durationData = useMemo(() => {
    const buckets = [15, 30, 45, 60, 75, 90, 120];
    const counts = buckets.map((b) => ({ label: `${b} min`, count: 0 }));
    filtered.forEach((s) => {
      if (!s.duree_minutes) return;
      const idx = buckets.indexOf(s.duree_minutes);
      if (idx >= 0) counts[idx].count += 1;
    });
    return counts.filter((c) => c.count > 0);
  }, [filtered]);

  const handleLogout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const handleSaveConfig = async () => {
    if (!profile) return;
    if (lienAction.trim()) {
      try {
        const u = new URL(lienAction.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      } catch {
        toast.error("Lien invalide : utilisez une adresse http(s)://");
        return;
      }
    }
    setSaving(true);
    const { error } = await supabase
      .from("commune_profiles")
      .update({ lien_action: lienAction.trim() || null, code_postal: codePostal || null })
      .eq("user_id", profile.user_id);
    setSaving(false);
    if (error) {
      toast.error("Échec de l'enregistrement");
    } else {
      toast.success("Modifications enregistrées");
      setProfile({ ...profile, lien_action: lienAction, code_postal: codePostal });
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!profile || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("commune-logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("commune-logos").getPublicUrl(path);
      const { error: dbErr } = await supabase
        .from("commune_profiles")
        .update({ logo_url: data.publicUrl })
        .eq("user_id", user.id);
      if (dbErr) throw dbErr;
      setProfile({ ...profile, logo_url: data.publicUrl });
      toast.success("Logo mis à jour");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur lors de l'envoi");
    } finally {
      setUploading(false);
    }
  };

  const downloadCsv = () => {
    const header = ["Date", "Point de départ", "Durée (min)", "Étapes"];
    const rows = filtered.map((s) => [
      new Date(s.created_at).toLocaleDateString("fr-FR"),
      (s.origin_address ?? s.ville ?? "").replace(/[,;]/g, " "),
      s.duree_minutes ?? "",
      (s.themes?.length ?? 3),
    ]);
    const csv = [header, ...rows].map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `microbalade-statistiques-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  

  if (loadingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex">
      <Helmet>
        <title>Dashboard partenaire — Microbalade</title>
      </Helmet>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-card border-r border-border flex flex-col transform transition-transform lg:transform-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Microbalade" className="h-7 w-auto" />
          </Link>
          <button className="lg:hidden text-muted-foreground" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = tab === n.key;
            const isLockedTab = locked && n.key !== "profile";
            return (
              <button
                key={n.key}
                onClick={() => {
                  if (isLockedTab) {
                    toast.error("Abonnement suspendu — régularisez le paiement pour réactiver cet onglet.");
                    setTab("profile");
                    setSidebarOpen(false);
                    return;
                  }
                  setTab(n.key);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isLockedTab
                    ? "text-muted-foreground/50 hover:bg-muted/50 cursor-not-allowed"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon size={18} />
                <span className="flex-1 text-left">{n.label}</span>
                {isLockedTab && <Lock size={13} className="opacity-60" />}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border space-y-2">
          <div className="px-3 py-2 text-xs text-muted-foreground truncate">{profile?.email}</div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut size={18} />
            Se déconnecter
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-card border-b border-border px-5 py-3 flex items-center justify-between lg:justify-end">
          <button
            className="lg:hidden text-muted-foreground"
            onClick={() => setSidebarOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={22} />
          </button>
          <div className="text-sm text-muted-foreground">
            {profile?.nom_collectivite}
          </div>
        </header>

        <main className="flex-1 p-5 md:p-8 max-w-6xl w-full mx-auto">
          {locked && (
            <div className="mb-6 flex items-start gap-3 bg-destructive/10 border border-destructive/30 rounded-2xl p-4">
              <AlertTriangle className="text-destructive shrink-0 mt-0.5" size={20} />
              <div className="text-sm">
                <div className="font-semibold text-foreground">Abonnement suspendu</div>
                <p className="text-muted-foreground mt-1">
                  Votre dashboard et l'affichage de votre logo sur Microbalade sont en pause.
                  Régularisez votre paiement via le portail sécurisé ci-dessous pour réactiver instantanément vos services.
                </p>
              </div>
            </div>
          )}
          {neverPaid && (
            <div className="mb-6 flex flex-col gap-3 bg-primary/10 border border-primary/30 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-primary shrink-0 mt-0.5" size={20} />
                <div className="text-sm flex-1">
                  <div className="font-semibold text-foreground">Abonnement inactif — paiement requis</div>
                  <p className="text-muted-foreground mt-1">
                    Votre compte est créé mais aucun paiement n'a été enregistré. Choisissez votre mode de règlement pour activer votre dashboard et l'affichage de votre logo sur Microbalade.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                <button
                  onClick={() => setChorusOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 bg-secondary text-foreground font-semibold rounded-xl px-4 py-2 text-sm hover:bg-secondary/80 transition border border-border"
                >
                  <FileTextIcon size={16} /> Bon de commande / Chorus Pro
                </button>
                <button
                  onClick={() => handlePay()}
                  className="inline-flex items-center justify-center bg-primary text-primary-foreground font-semibold rounded-xl px-4 py-2 text-sm hover:opacity-90 transition"
                >
                  Payer par carte
                </button>
              </div>
            </div>
          )}
          {isPendingMandat && (
            <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-2xl p-4">
              <FileTextIcon className="text-amber-700 shrink-0 mt-0.5" size={20} />
              <div className="text-sm flex-1">
                <div className="font-semibold text-foreground">Règlement par Chorus Pro en attente</div>
                <p className="text-muted-foreground mt-1">
                  Votre compte est <strong>activé</strong>. La facture a été émise et doit être réglée
                  {profile?.chorus_due_date ? (
                    <> avant le <strong>{new Date(profile.chorus_due_date).toLocaleDateString("fr-FR")}</strong></>
                  ) : (
                    <> sous 30 jours</>
                  )}
                  . Une fois le virement reçu, votre statut passera à « Actif ».
                </p>
              </div>
            </div>
          )}
          {tab === "overview" && (
            <section className="space-y-6">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
                    Bonjour, {profile?.nom_collectivite}
                  </h1>
                  <p className="text-sm text-muted-foreground">Activité Microbalade sur votre territoire.</p>
                </div>
                <div className="flex items-end gap-2 bg-card border border-border rounded-xl p-2 shadow-sm">
                  <div className="space-y-0.5">
                    <label htmlFor="date-from" className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Du</label>
                    <input
                      id="date-from"
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      max={to}
                      className="bg-transparent text-sm text-foreground px-2 py-1 rounded-md cursor-pointer hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/30 w-[140px]"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <label htmlFor="date-to" className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Au</label>
                    <input
                      id="date-to"
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      min={from}
                      className="bg-transparent text-sm text-foreground px-2 py-1 rounded-md cursor-pointer hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/30 w-[140px]"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-2xl p-5 md:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isPendingMandat ? "bg-amber-500" : isActive ? "bg-emerald-500" : "bg-destructive"
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Statut de l'abonnement
                    </div>
                    <div className="text-lg font-extrabold text-foreground">
                      {isPendingMandat ? "Actif — règlement Chorus en attente" : isActive ? "Actif" : "Inactif — paiement requis"}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      Formule : <span className="font-semibold text-foreground">{profile?.abonnement_label ?? "—"}</span>
                      {profile?.abonnement_prix_annuel ? ` · ${profile.abonnement_prix_annuel} € / an` : ""}
                    </div>
                  </div>
                </div>
                {!isActive ? (
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <button
                      onClick={() => setChorusOpen(true)}
                      className="inline-flex items-center justify-center gap-1.5 bg-secondary text-foreground font-semibold rounded-xl px-4 py-2 text-sm hover:bg-secondary/80 transition border border-border"
                    >
                      <FileTextIcon size={16} /> Bon de commande
                    </button>
                    <button
                      onClick={() => handlePay()}
                      className="inline-flex items-center justify-center bg-primary text-primary-foreground font-semibold rounded-xl px-4 py-2 text-sm hover:opacity-90 transition"
                    >
                      Payer par carte
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setTab("profile")}
                    className="shrink-0 inline-flex items-center justify-center bg-secondary text-foreground font-semibold rounded-xl px-4 py-2 text-sm hover:bg-secondary/80 transition"
                  >
                    Gérer
                  </button>
                )}
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard icon={Footprints} label="Balades générées" value={totalBalades.toString()} sub="Sur la période sélectionnée" />
                <StatCard icon={Clock} label="Durée moyenne demandée" value={`${avgDuration} min`} sub="Par balade" />
                <StatCard
                  icon={TrendingUp}
                  label="Monuments uniques mis en avant"
                  value={topMonuments.length.toString()}
                  sub="Affichés au moins une fois"
                />
                <StatCard icon={QrCode} label="Scans du QR code" value={(traffic?.qr_scans ?? 0).toString()} sub="Sur la période sélectionnée" />
                <StatCard icon={MapPinned} label="Visites de votre page" value={(traffic?.page_visits ?? 0).toString()} sub={traffic?.slug ? `microbalade.fr/${traffic.slug}` : "Page non encore créée"} />
                <StatCard
                  icon={TrendingUp}
                  label="Taux scan → balade"
                  value={qrRate === null ? "—" : `${qrRate} %`}
                  sub={`${traffic?.qr_balades ?? 0} balade(s) lancée(s) depuis un scan`}
                />
              </div>

              <div className="bg-card border border-border rounded-2xl p-5 md:p-6">
                <h2 className="font-semibold text-foreground mb-4">Évolution des balades générées</h2>
                {monthlyData.length === 0 ? (
                  <EmptyChart />
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="balades" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 12,
                            fontSize: 12,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="balades"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2.5}
                          fill="url(#balades)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="grid lg:grid-cols-2 gap-5">
                <div className="bg-card border border-border rounded-2xl p-5 md:p-6">
                  <h2 className="font-semibold text-foreground mb-4">Monuments & rues les plus visités</h2>
                  {topMonuments.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      Aucune donnée sur cette période.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {topMonuments.map((m, i) => {
                        const max = topMonuments[0].count;
                        const pct = (m.count / max) * 100;
                        return (
                          <li key={m.name} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-foreground truncate pr-3">
                                <span className="text-muted-foreground font-mono text-xs mr-2">#{i + 1}</span>
                                {m.name}
                              </span>
                              <span className="text-foreground font-semibold tabular-nums">{m.count}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="bg-card border border-border rounded-2xl p-5 md:p-6">
                  <h2 className="font-semibold text-foreground mb-4">Durées de balade privilégiées</h2>
                  {durationData.length === 0 ? (
                    <EmptyChart />
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={durationData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                          <Tooltip
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: 12,
                              fontSize: 12,
                            }}
                          />
                          <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {tab === "stats" && (
            <section className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold text-foreground">Données & statistiques</h1>
                  <p className="text-sm text-muted-foreground">Historique des balades générées par vos visiteurs.</p>
                </div>
                <button
                  onClick={downloadCsv}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-all"
                >
                  <Download size={16} />
                  Télécharger (.CSV)
                </button>
              </div>

              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-5 py-3 font-semibold">Date</th>
                        <th className="text-left px-5 py-3 font-semibold">Point de départ</th>
                        <th className="text-left px-5 py-3 font-semibold">Durée</th>
                        <th className="text-left px-5 py-3 font-semibold">Étapes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center py-10 text-muted-foreground text-sm">
                            Aucune recherche sur la période sélectionnée.
                          </td>
                        </tr>
                      )}
                      {filtered.map((s) => (
                        <tr key={s.id} className="hover:bg-muted/30">
                          <td className="px-5 py-3 text-foreground">
                            {new Date(s.created_at).toLocaleDateString("fr-FR")}
                          </td>
                          <td className="px-5 py-3 text-foreground truncate max-w-xs">
                            {s.origin_address ?? s.ville ?? "—"}
                          </td>
                          <td className="px-5 py-3 text-muted-foreground">
                            {s.duree_minutes ? `${s.duree_minutes} min` : "—"}
                          </td>
                          <td className="px-5 py-3 text-muted-foreground">{s.themes?.length ?? 3}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {tab === "config" && (
            <section className="space-y-6 max-w-2xl">
              <div>
                <h1 className="text-2xl font-extrabold text-foreground">Configuration du territoire</h1>
                <p className="text-sm text-muted-foreground">Personnalisez l'apparence de vos parcours.</p>
              </div>

              <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                <div>
                  <h2 className="font-semibold text-foreground mb-1">Logo officiel</h2>
                  <p className="text-xs text-muted-foreground mb-4">
                    Il sera affiché en en-tête des parcours générés sur votre commune.
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl bg-muted border border-border flex items-center justify-center overflow-hidden">
                      {profile?.logo_url ? (
                        <img src={profile.logo_url} alt="Logo" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-xs text-muted-foreground text-center px-2">Aucun logo</span>
                      )}
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleLogoUpload(f);
                      }}
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="inline-flex items-center gap-2 bg-secondary hover:bg-muted text-foreground px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-70"
                    >
                      {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      {profile?.logo_url ? "Remplacer le logo" : "Charger un logo"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
                <div>
                  <h2 className="font-semibold text-foreground mb-1">Lien permanent</h2>
                  <p className="text-xs text-muted-foreground">
                    URL affichée sous forme de bouton sous la carte des parcours (ex : site de l'office de tourisme).
                  </p>
                </div>
                <div className="relative">
                  <ExternalLink size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="url"
                    value={lienAction}
                    onChange={(e) => setLienAction(e.target.value)}
                    placeholder="https://www.tourisme-saint-omer.com"
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
                <div>
                  <h2 className="font-semibold text-foreground mb-1">Code postal</h2>
                  <p className="text-xs text-muted-foreground">Pour ciblage des statistiques.</p>
                </div>
                <div className="flex gap-2">
                  <input
                    value={codePostal}
                    onChange={(e) => setCodePostal(e.target.value)}
                    placeholder="62500"
                    className="flex-1 bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    type="button"
                    onClick={detectCodePostal}
                    className="px-4 py-3 rounded-xl text-sm font-medium bg-secondary text-foreground hover:bg-secondary/70 transition"
                  >
                    Détecter
                  </button>
                </div>
              </div>

              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-all disabled:opacity-70"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                Enregistrer les modifications
              </button>
            </section>
          )}

          {tab === "pois" && user && (
            <CommunePois
              userId={user.id}
              codePostal={profile?.code_postal ?? null}
              communeName={profile?.nom_collectivite ?? ""}
            />
          )}

          {tab === "qrcode" && (
            <CommuneQrCode
              communeName={profile?.nom_collectivite ?? "Microbalade"}
              slug={traffic?.slug ?? null}
              logoUrl={profile?.logo_url ?? null}
            />
          )}

          {tab === "profile" && (
            <section className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-foreground">Profil & facturation</h1>
                <p className="text-sm text-muted-foreground">Informations administratives et abonnement.</p>
              </div>

              <div className="bg-card border border-border rounded-2xl p-6 grid sm:grid-cols-2 gap-4">
                <InfoLine label="Collectivité" value={profile?.nom_collectivite ?? "—"} />
                <InfoLine label="Code postal" value={profile?.code_postal ?? "—"} />
                <InfoLine label="Email" value={profile?.email ?? "—"} />
                <InfoLine
                  label="Membre depuis"
                  value={profile ? new Date(profile.abonnement_renouvellement).getFullYear() - 1 + "" : "—"}
                />
              </div>

              <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                <h2 className="font-semibold text-foreground">Abonnement en cours</h2>
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <div className="text-xl font-extrabold text-foreground">
                      {profile?.abonnement_label} – {profile?.abonnement_prix_annuel} € / an
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Prochain renouvellement :{" "}
                      <span className="font-semibold text-foreground">
                        {profile
                          ? new Date(profile.abonnement_renouvellement).toLocaleDateString("fr-FR")
                          : "—"}
                      </span>
                    </p>
                  </div>
                  {(() => {
                    const map: Record<string, { label: string; cls: string }> = {
                      active: { label: "Actif", cls: "text-emerald-700 bg-emerald-100" },
                      trialing: { label: "Inactif — paiement requis", cls: "text-destructive bg-destructive/10" },
                      past_due: { label: "Paiement en retard", cls: "text-amber-700 bg-amber-100" },
                      unpaid: { label: "Impayé", cls: "text-destructive bg-destructive/10" },
                      canceled: { label: "Annulé", cls: "text-destructive bg-destructive/10" },
                      incomplete: { label: "Inactif — paiement requis", cls: "text-destructive bg-destructive/10" },
                    };
                    const s = map[status ?? "trialing"] ?? map.trialing;
                    return (
                      <span className={`text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full ${s.cls}`}>
                        {s.label}
                      </span>
                    );
                  })()}
                </div>
                {neverPaid && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Changer de formule
                    </label>
                    <select
                      value={getCommunePriceIdFromAmount(profile?.abonnement_prix_annuel ?? 600)}
                      disabled={changingTier}
                      onChange={(e) => changeTier(e.target.value)}
                      className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {COMMUNE_TIERS.map((t) => (
                        <option key={t.priceId} value={t.priceId}>
                          {t.label} — {t.amountEur.toLocaleString("fr-FR")} € / an
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                <h2 className="font-semibold text-foreground">Factures & paiement</h2>
                <p className="text-sm text-muted-foreground">
                  Téléchargez vos factures PDF officielles, mettez à jour votre moyen de paiement
                  et gérez votre abonnement depuis le portail sécurisé Stripe.
                </p>
                <button
                  onClick={async () => {
                    const loadingId = toast.loading("Ouverture du portail Stripe…");
                    try {
                      const { data, error } = await supabase.functions.invoke("create-portal-session", {
                        body: {
                          returnUrl: window.location.origin + "/dashboard/commune",
                          environment: getStripeEnvironment(),
                        },
                      });
                      toast.dismiss(loadingId);
                      if (data?.url) {
                        window.open(data.url, "_blank", "noopener,noreferrer");
                        return;
                      }
                      const msg = (error as { message?: string } | null)?.message ?? "";
                      if (msg.includes("404") || msg.toLowerCase().includes("no customer")) {
                        toast.error("Aucun abonnement actif. Souscrivez d'abord depuis la page Partenaires.");
                        navigate("/partenaires");
                      } else {
                        toast.error("Impossible d'ouvrir le portail. Réessayez dans un instant.");
                      }
                    } catch {
                      toast.dismiss(loadingId);
                      toast.error("Impossible d'ouvrir le portail pour le moment.");
                    }
                  }}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-all"
                >
                  <ExternalLink size={16} />
                  Gérer mon abonnement et mes factures
                </button>
              </div>
            </section>
          )}
        </main>
      </div>

      <Dialog open={checkoutOpen} onOpenChange={(o) => { if (!o) closeCheckout(); }}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Paiement de votre abonnement</DialogTitle>
            <DialogDescription>
              {profile?.abonnement_label} – {profile?.abonnement_prix_annuel} € / an. Paiement sécurisé via Stripe.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 max-h-[75vh] overflow-y-auto">
            {checkoutElement}
          </div>
        </DialogContent>
      </Dialog>

      {profile && user && (
        <ChorusRequestDialog
          open={chorusOpen}
          onOpenChange={setChorusOpen}
          userId={user.id}
          email={profile.email}
          nomCollectivite={profile.nom_collectivite}
          prixAnnuel={profile.abonnement_prix_annuel}
          formuleLabel={profile.abonnement_label}
          initial={{
            siret: profile.siret,
            numero_engagement: profile.numero_engagement,
            code_service_chorus: profile.code_service_chorus,
            adresse_facturation: profile.adresse_facturation,
            email_comptabilite: profile.email_comptabilite,
          }}
          onSuccess={async () => {
            const { data } = await supabase
              .from("commune_profiles")
              .select("*")
              .eq("user_id", user.id)
              .maybeSingle();
            if (data) setProfile(data as CommuneProfile);
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          <Icon size={18} />
        </div>
      </div>
      <div className="mt-3 text-3xl font-extrabold text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm text-foreground mt-1">{value}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
      Aucune donnée sur la période sélectionnée.
    </div>
  );
}
