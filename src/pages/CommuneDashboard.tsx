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
import logo from "@/assets/logo.png";

type TabKey = "overview" | "stats" | "config" | "profile";

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
  { key: "profile", label: "Profil & Facturation", icon: UserCircle2 },
];

const fakeInvoices = [
  { id: "F-2025-05", date: "01/05/2025", amount: 600, label: "Abonnement annuel 2025" },
  { id: "F-2024-05", date: "01/05/2024", amount: 600, label: "Abonnement annuel 2024" },
];

const MONTHS_FR = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function CommuneDashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState<TabKey>("overview");
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

  // Form state
  const [lienAction, setLienAction] = useState("");
  const [codePostal, setCodePostal] = useState("");

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
      }
      setLoadingProfile(false);
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("statistiques_recherches")
        .select("id, created_at, ville, origin_address, duree_minutes, themes")
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setSearches(data as SearchRow[]);
    })();
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const handleSaveConfig = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from("commune_profiles")
      .update({ lien_action: lienAction || null, code_postal: codePostal || null })
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
    const rows = searches.map((s) => [
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

  const totalThisMonth = useMemo(() => monthlyData[monthlyData.length - 1].balades, []);

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
            return (
              <button
                key={n.key}
                onClick={() => {
                  setTab(n.key);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon size={18} />
                {n.label}
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
          {tab === "overview" && (
            <section className="space-y-6">
              <div>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
                  Bonjour, {profile?.nom_collectivite}
                </h1>
                <p className="text-sm text-muted-foreground">Voici l'activité Microbalade sur votre territoire.</p>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard icon={Footprints} label="Balades générées ce mois-ci" value={totalThisMonth.toString()} sub="+161 % vs avril" />
                <StatCard icon={Clock} label="Temps moyen passé" value="32 min" sub="Sur l'app" />
                <StatCard icon={TrendingUp} label="Croissance trimestrielle" value="+275 %" sub="Mars → Mai" />
              </div>

              <div className="bg-card border border-border rounded-2xl p-5 md:p-6">
                <h2 className="font-semibold text-foreground mb-4">Évolution des balades générées</h2>
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
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
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
                      {searches.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center py-10 text-muted-foreground text-sm">
                            Aucune recherche enregistrée pour l'instant.
                          </td>
                        </tr>
                      )}
                      {searches.map((s) => (
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
                <input
                  value={codePostal}
                  onChange={(e) => setCodePostal(e.target.value)}
                  placeholder="62500"
                  className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
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
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">
                    Actif
                  </span>
                </div>
              </div>

              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border">
                  <h2 className="font-semibold text-foreground">Factures passées</h2>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-6 py-3 font-semibold">Référence</th>
                      <th className="text-left px-6 py-3 font-semibold">Date</th>
                      <th className="text-left px-6 py-3 font-semibold">Libellé</th>
                      <th className="text-right px-6 py-3 font-semibold">Montant</th>
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {fakeInvoices.map((f) => (
                      <tr key={f.id} className="hover:bg-muted/30">
                        <td className="px-6 py-3 text-foreground font-medium">{f.id}</td>
                        <td className="px-6 py-3 text-muted-foreground">{f.date}</td>
                        <td className="px-6 py-3 text-muted-foreground">{f.label}</td>
                        <td className="px-6 py-3 text-right text-foreground font-semibold">{f.amount} €</td>
                        <td className="px-6 py-3 text-right">
                          <button
                            onClick={() => toast.info("Téléchargement PDF bientôt disponible")}
                            className="inline-flex items-center gap-1.5 text-primary text-xs font-semibold hover:underline"
                          >
                            <FileText size={14} />
                            PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
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
