import { useEffect, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminPilots from "@/components/AdminPilots";
import { toast } from "sonner";
import { Trash2, Plus, Save, Upload, Download, Loader2 } from "lucide-react";

interface Commune {
  id: string;
  nom: string;
  code_postal: string;
  logo_url: string | null;
  lien_action: string | null;
  active: boolean;
}

interface StatRow {
  id: string;
  ville: string | null;
  code_postal: string | null;
  duree_minutes: number | null;
  themes: string[] | null;
  monuments: string[] | null;
  origin_address: string | null;
  created_at: string;
}

const PWD_KEY = "mb_admin_pwd";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.readAsDataURL(file);
  });

const AdminCommunes = () => {
  const [password, setPassword] = useState<string>(() => sessionStorage.getItem(PWD_KEY) ?? "");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [form, setForm] = useState({ nom: "", code_postal: "", logo_url: "", lien_action: "", active: true });
  const [uploadingNew, setUploadingNew] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState<StatRow[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [filterCommune, setFilterCommune] = useState<string>("all");

  // Chorus
  const [chorus, setChorus] = useState<any[]>([]);
  const [chorusLoading, setChorusLoading] = useState(false);
  const [chorusFilter, setChorusFilter] = useState<string>("pending");

  const loadChorus = async () => {
    setChorusLoading(true);
    try {
      const res = await call("list_chorus", { status: chorusFilter });
      setChorus(res.data ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setChorusLoading(false);
    }
  };

  const markChorusPaid = async (user_id: string) => {
    if (!confirm("Marquer comme payé et activer l'abonnement ?")) return;
    try {
      await call("mark_chorus_paid", { user_id });
      toast.success("Abonnement activé");
      loadChorus();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const markChorusOverdue = async (user_id: string) => {
    try {
      await call("mark_chorus_overdue", { user_id });
      toast.success("Marqué en retard");
      loadChorus();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const [health, setHealth] = useState<{ success: number; failed: number; cache_rate: number; median_ms: number } | null>(null);

  const call = async (action: string, payload?: any) => {
    const { data, error } = await supabase.functions.invoke("admin-communes", {
      body: { password, action, payload },
    });
    // When the edge function returns a non-2xx response, supabase-js sets `error`
    // (FunctionsHttpError) but the body containing our real error message is on
    // `error.context.response`. We extract it so the user sees the real reason
    // (e.g. "Image trop volumineuse") instead of a generic "non-2xx status code".
    if (error) {
      try {
        const resp: Response | undefined = (error as any)?.context?.response;
        if (resp) {
          const body = await resp.clone().json().catch(() => null);
          if (body?.error) throw new Error(body.error);
        }
      } catch (e: any) {
        if (e?.message) throw e;
      }
      throw error;
    }
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  };

  // Auto-fill commune name from postcode using the official French geo API.
  const lookupCommuneByPostcode = async (cp: string): Promise<string | null> => {
    if (!/^\d{5}$/.test(cp)) return null;
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom&format=json`
      );
      if (!r.ok) return null;
      const arr = await r.json();
      return Array.isArray(arr) && arr[0]?.nom ? arr[0].nom : null;
    } catch {
      return null;
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await call("list");
      setCommunes(res.data ?? []);
      setAuthed(true);
      sessionStorage.setItem(PWD_KEY, password);
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (codePostal?: string) => {
    setStatsLoading(true);
    try {
      const payload: any = {};
      if (codePostal && codePostal !== "all") payload.code_postal = codePostal;
      const res = await call("list_stats", payload);
      setStats(res.data ?? []);
      call("health").then((h) => setHealth(h.data ?? null)).catch(() => setHealth(null));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    if (password && !authed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadLogo = async (file: File): Promise<string | null> => {
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Image trop volumineuse (max 2 Mo)");
      return null;
    }
    const data_base64 = await fileToBase64(file);
    const res = await call("upload_logo", {
      filename: file.name,
      content_type: file.type,
      data_base64,
    });
    return res.url as string;
  };

  const handleCreate = async () => {
    if (!form.nom || !form.code_postal) {
      toast.error("Nom et code postal requis");
      return;
    }
    try {
      await call("create", form);
      setForm({ nom: "", code_postal: "", logo_url: "", lien_action: "", active: true });
      toast.success("Commune ajoutée");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUpdate = async (c: Commune) => {
    try {
      await call("update", c);
      toast.success("Mis à jour");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette commune ?")) return;
    try {
      await call("delete", { id });
      toast.success("Supprimée");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const updateLocal = (id: string, patch: Partial<Commune>) => {
    setCommunes((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const exportStatsToExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Statistiques");
    ws.columns = [
      { header: "Date", key: "date", width: 20 },
      { header: "Ville", key: "ville", width: 20 },
      { header: "Code postal", key: "cp", width: 12 },
      { header: "Durée (min)", key: "duree", width: 12 },
      { header: "Adresse de départ", key: "addr", width: 40 },
      { header: "Thèmes", key: "themes", width: 30 },
      { header: "Monuments", key: "monuments", width: 60 },
    ];
    ws.getRow(1).font = { bold: true };
    stats.forEach((s) => {
      ws.addRow({
        date: new Date(s.created_at).toLocaleString("fr-FR"),
        ville: s.ville ?? "",
        cp: s.code_postal ?? "",
        duree: s.duree_minutes ?? "",
        addr: s.origin_address ?? "",
        themes: (s.themes ?? []).join(", "),
        monuments: (s.monuments ?? []).join(" | "),
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const suffix =
      filterCommune !== "all"
        ? `_${communes.find((c) => c.code_postal === filterCommune)?.nom ?? filterCommune}`
        : "";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `microbalade_statistiques${suffix}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-6 w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">Admin — Microbalade</h1>
          <div className="space-y-2">
            <Label>Mot de passe</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </div>
          <Button className="w-full" onClick={load} disabled={loading || !password}>
            {loading ? "Connexion..." : "Se connecter"}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Administration</h1>

      <Tabs defaultValue="communes" onValueChange={(v) => { if (v === "stats") loadStats(filterCommune); if (v === "chorus") loadChorus(); }}>
        <TabsList>
          <TabsTrigger value="communes">Communes partenaires</TabsTrigger>
          <TabsTrigger value="chorus">Chorus Pro</TabsTrigger>
          <TabsTrigger value="stats">Statistiques</TabsTrigger>
          <TabsTrigger value="pois">Lieux</TabsTrigger>
          <TabsTrigger value="pilots">Pilotes</TabsTrigger>
        </TabsList>

        <TabsContent value="communes" className="mt-6">
          <Card className="p-4 mb-6 space-y-3">
            <h2 className="font-medium">Ajouter une commune</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Nom</Label>
                <Input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
              </div>
              <div>
                <Label>Code postal</Label>
                <Input
                  value={form.code_postal}
                  onChange={(e) => setForm({ ...form, code_postal: e.target.value })}
                  onBlur={async () => {
                    if (form.nom || !/^\d{5}$/.test(form.code_postal)) return;
                    const nom = await lookupCommuneByPostcode(form.code_postal);
                    if (nom) setForm((prev) => (prev.nom ? prev : { ...prev, nom }));
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Logo</Label>
                <LogoDropzone
                  uploading={uploadingNew}
                  currentUrl={form.logo_url}
                  onFile={async (f) => {
                    setUploadingNew(true);
                    try {
                      const url = await uploadLogo(f);
                      if (url) {
                        setForm((prev) => ({ ...prev, logo_url: url }));
                        toast.success("Logo téléversé");
                      }
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setUploadingNew(false);
                    }
                  }}
                  onClear={() => setForm({ ...form, logo_url: "" })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Lien d'action (bouton sous la carte)</Label>
                <Input
                  value={form.lien_action}
                  onChange={(e) => setForm({ ...form, lien_action: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.active}
                  onCheckedChange={(v) => setForm({ ...form, active: v })}
                />
                <Label>Active</Label>
              </div>
            </div>
            <Button onClick={handleCreate}>
              <Plus className="w-4 h-4 mr-1" /> Ajouter
            </Button>
          </Card>

          <div className="space-y-3">
            {communes.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Aucune commune.</p>
            )}
            {communes.map((c) => (
              <Card key={c.id} className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Nom</Label>
                    <Input value={c.nom} onChange={(e) => updateLocal(c.id, { nom: e.target.value })} />
                  </div>
                  <div>
                    <Label>Code postal</Label>
                    <Input
                      value={c.code_postal}
                      onChange={(e) => updateLocal(c.id, { code_postal: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Logo</Label>
                    <LogoDropzone
                      uploading={uploadingId === c.id}
                      currentUrl={c.logo_url}
                      onFile={async (f) => {
                        setUploadingId(c.id);
                        try {
                          const url = await uploadLogo(f);
                          if (url) {
                            updateLocal(c.id, { logo_url: url });
                            toast.success("Logo téléversé (pensez à enregistrer)");
                          }
                        } catch (e: any) {
                          toast.error(e.message);
                        } finally {
                          setUploadingId(null);
                        }
                      }}
                      onClear={() => updateLocal(c.id, { logo_url: null })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Lien d'action</Label>
                    <Input
                      value={c.lien_action ?? ""}
                      onChange={(e) => updateLocal(c.id, { lien_action: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={c.active}
                      onCheckedChange={(v) => updateLocal(c.id, { active: v })}
                    />
                    <Label>Active</Label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleUpdate(c)}>
                      <Save className="w-4 h-4 mr-1" /> Enregistrer
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pilots" className="mt-6">
          <AdminPilots call={call} />
        </TabsContent>

        <TabsContent value="pois" className="mt-6">
          <AdminPois call={call} />
        </TabsContent>

        <TabsContent value="chorus" className="mt-6 space-y-3">
          <Card className="p-4 flex flex-col sm:flex-row gap-3 sm:items-end justify-between">
            <div className="flex-1">
              <Label>Filtrer par statut</Label>
              <select
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={chorusFilter}
                onChange={(e) => { setChorusFilter(e.target.value); setTimeout(loadChorus, 0); }}
              >
                <option value="pending">En attente</option>
                <option value="overdue">En retard</option>
                <option value="paid">Payés</option>
                <option value="all">Tous</option>
              </select>
            </div>
            <Button variant="outline" onClick={loadChorus} disabled={chorusLoading}>
              {chorusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rafraîchir"}
            </Button>
          </Card>

          {chorus.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Aucune demande Chorus.</p>
          )}

          {chorus.map((c) => (
            <Card key={c.id} className="p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.nom_collectivite} <span className="text-muted-foreground font-normal">({c.code_postal ?? "—"})</span></div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  c.chorus_status === "paid" ? "bg-emerald-100 text-emerald-800" :
                  c.chorus_status === "overdue" ? "bg-destructive/15 text-destructive" :
                  "bg-amber-100 text-amber-800"
                }`}>
                  {c.chorus_status === "paid" ? "Payé" : c.chorus_status === "overdue" ? "En retard" : "En attente"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div><span className="text-muted-foreground">SIRET :</span> {c.siret ?? "—"}</div>
                <div><span className="text-muted-foreground">Engagement :</span> {c.numero_engagement ?? "—"}</div>
                <div><span className="text-muted-foreground">Code service :</span> {c.code_service_chorus ?? "—"}</div>
                <div><span className="text-muted-foreground">Compta :</span> {c.email_comptabilite ?? "—"}</div>
                <div className="sm:col-span-2 whitespace-pre-line"><span className="text-muted-foreground">Adresse :</span> {c.adresse_facturation ?? "—"}</div>
                <div><span className="text-muted-foreground">Formule :</span> {c.abonnement_label} — {c.abonnement_prix_annuel} €</div>
                <div><span className="text-muted-foreground">Échéance :</span> {c.chorus_due_date ? new Date(c.chorus_due_date).toLocaleDateString("fr-FR") : "—"}</div>
                <div><span className="text-muted-foreground">Demandé le :</span> {c.chorus_requested_at ? new Date(c.chorus_requested_at).toLocaleDateString("fr-FR") : "—"}</div>
                {c.chorus_paid_at && <div><span className="text-muted-foreground">Payé le :</span> {new Date(c.chorus_paid_at).toLocaleDateString("fr-FR")}</div>}
              </div>
              {c.chorus_status !== "paid" && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => markChorusPaid(c.user_id)}>Marquer comme payé</Button>
                  {c.chorus_status !== "overdue" && (
                    <Button size="sm" variant="outline" onClick={() => markChorusOverdue(c.user_id)}>Marquer en retard</Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="stats" className="mt-6 space-y-4">
          <Card className="p-4 flex flex-col sm:flex-row gap-3 sm:items-end justify-between">
            <div className="flex-1 min-w-0">
              <Label>Filtrer par commune partenaire</Label>
              <select
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={filterCommune}
                onChange={(e) => {
                  setFilterCommune(e.target.value);
                  loadStats(e.target.value);
                }}
              >
                <option value="all">Toutes les communes</option>
                {communes.map((c) => (
                  <option key={c.id} value={c.code_postal}>
                    {c.nom} ({c.code_postal})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => loadStats(filterCommune)} disabled={statsLoading}>
                {statsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Rafraîchir"}
              </Button>
              <Button onClick={exportStatsToExcel} disabled={stats.length === 0}>
                <Download className="w-4 h-4 mr-1" /> Exporter Excel
              </Button>
            </div>
          </Card>

          {(() => {
            const balades = stats.length;
            const aiCalls = balades; // 1 seul appel IA par balade
            const costUsd = balades * 0.004; // estimation Gemini 2.5 Flash
            return (
              <>
              <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-2xl font-semibold">{balades}</div>
                  <div className="text-xs text-muted-foreground">Balades générées</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{aiCalls}</div>
                  <div className="text-xs text-muted-foreground">Appels IA (Gemini)</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">${costUsd.toFixed(3)}</div>
                  <div className="text-xs text-muted-foreground">Coût IA estimé</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">${balades ? (costUsd / balades).toFixed(4) : "0.0000"}</div>
                  <div className="text-xs text-muted-foreground">Coût / balade</div>
                </div>
              </Card>
              {health && (
                <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div>
                    <div className="text-2xl font-semibold">{health.success}</div>
                    <div className="text-xs text-muted-foreground">Réussies (30 j)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{health.failed}</div>
                    <div className="text-xs text-muted-foreground">Échouées (30 j)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{Math.round(health.cache_rate * 100)} %</div>
                    <div className="text-xs text-muted-foreground">Taux de cache</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{(health.median_ms / 1000).toFixed(1)} s</div>
                    <div className="text-xs text-muted-foreground">Durée médiane</div>
                  </div>
                </Card>
              )}
              </>
            );
          })()}

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Ville</th>
                    <th className="px-3 py-2 font-medium">CP</th>
                    <th className="px-3 py-2 font-medium">Durée</th>
                    <th className="px-3 py-2 font-medium">Thèmes</th>
                    <th className="px-3 py-2 font-medium">Monuments</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.length === 0 && !statsLoading && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted-foreground py-8">
                        Aucune recherche.
                      </td>
                    </tr>
                  )}
                  {stats.map((s) => (
                    <tr key={s.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {new Date(s.created_at).toLocaleString("fr-FR")}
                      </td>
                      <td className="px-3 py-2">{s.ville ?? "—"}</td>
                      <td className="px-3 py-2">{s.code_postal ?? "—"}</td>
                      <td className="px-3 py-2">{s.duree_minutes ?? "—"} min</td>
                      <td className="px-3 py-2">{(s.themes ?? []).join(", ")}</td>
                      <td className="px-3 py-2 max-w-md">
                        <span className="text-muted-foreground">
                          {(s.monuments ?? []).join(" • ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
              {stats.length} résultat{stats.length > 1 ? "s" : ""}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

interface LogoDropzoneProps {
  uploading: boolean;
  currentUrl: string | null | undefined;
  onFile: (file: File) => void;
  onClear: () => void;
}

const LogoDropzone = ({ uploading, currentUrl, onFile, onClear }: LogoDropzoneProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast.error("Veuillez déposer une image");
      return;
    }
    onFile(f);
  };

  return (
    <div className="space-y-2">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files);
        }}
        className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-3 cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        {currentUrl ? (
          <img
            src={currentUrl}
            alt="Logo"
            className="h-12 w-12 object-contain bg-white rounded border border-border"
            onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.3")}
          />
        ) : (
          <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
            <Upload className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 text-sm">
          {uploading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Téléversement...
            </span>
          ) : (
            <>
              <p className="font-medium">Glissez une image ou cliquez</p>
              <p className="text-xs text-muted-foreground">PNG, JPG, SVG, WEBP — max 2 Mo</p>
            </>
          )}
        </div>
        {currentUrl && !uploading && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />
      </div>
    </div>
  );
};

export default AdminCommunes;

function AdminPois({ call }: { call: (action: string, payload?: any) => Promise<any> }) {
  const [cp, setCp] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const res = await call("list_pois", { code_postal: cp.trim() || undefined });
      setRows(res.data ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const update = async (id: string, fields: Record<string, unknown>) => {
    try {
      const res = await call("update_poi", { id, ...fields });
      setRows((r) => r.map((x) => (x.id === id ? res.data : x)));
      toast.success("Lieu mis à jour");
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const remove = async (id: string) => {
    if (!confirm("Supprimer ce lieu ?")) return;
    try {
      await call("delete_poi", { id });
      setRows((r) => r.filter((x) => x.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  return (
    <div className="space-y-3">
      <Card className="p-4 flex gap-3 items-end">
        <div className="flex-1">
          <Label>Code postal (vide = tous)</Label>
          <Input value={cp} onChange={(e) => setCp(e.target.value)} placeholder="62500" />
        </div>
        <Button onClick={load} disabled={busy}>{busy ? "Chargement…" : "Afficher"}</Button>
      </Card>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Aucun lieu.</p>}
      {rows.map((p) => (
        <Card key={p.id} className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{p.nom} <span className="text-xs text-muted-foreground">· {p.code_postal} · {p.categorie}</span></p>
              <p className="text-xs text-muted-foreground">{Number(p.lat).toFixed(5)}, {Number(p.lon).toFixed(5)}{p.url_source ? ` · ${p.url_source}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={p.active} onCheckedChange={(v) => update(p.id, { active: v })} />
              <Button variant="destructive" size="sm" onClick={() => remove(p.id)}>Supprimer</Button>
            </div>
          </div>
          <Textarea
            defaultValue={p.description}
            maxLength={800}
            onBlur={(e) => e.target.value !== p.description && update(p.id, { description: e.target.value })}
          />
        </Card>
      ))}
    </div>
  );
}
