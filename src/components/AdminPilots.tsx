import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

type Pilot = {
  id: string;
  commune_nom: string;
  code_postal: string | null;
  population: number | null;
  contact_nom: string;
  fonction: string;
  email: string;
  telephone: string | null;
  message: string | null;
  status: "nouveau" | "contacte" | "pilote_actif" | "refuse";
  created_at: string;
};

const STATUS_LABEL: Record<Pilot["status"], string> = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  pilote_actif: "Pilote actif",
  refuse: "Refusé",
};

export default function AdminPilots({ call }: { call: (action: string, payload?: any) => Promise<any> }) {
  const [rows, setRows] = useState<Pilot[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await call("list_pilots");
      setRows(r.data ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (id: string, status: Pilot["status"]) => {
    try {
      await call("update_pilot_status", { id, status });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const activate = async (p: Pilot) => {
    setBusy(p.id);
    try {
      const r = await call("activate_pilot", { id: p.id });
      if (!r.data?.found) {
        toast.error("Aucun compte avec cet email : invitez la commune à s'inscrire sur /partenaires/connexion");
      } else {
        toast.success(`Pilote activé jusqu'au ${new Date(r.data.until).toLocaleDateString("fr-FR")}`);
        setRows((rs) => rs.map((x) => (x.id === p.id ? { ...x, status: "pilote_actif" } : x)));
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Demandes de pilote gratuit ({rows.length})</h2>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} Actualiser
        </Button>
      </div>
      {rows.length === 0 && !loading && <p className="text-sm text-muted-foreground">Aucune demande pour l'instant.</p>}
      {rows.map((p) => (
        <Card key={p.id} className="p-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold">
                {p.commune_nom} {p.code_postal && <span className="text-muted-foreground font-normal">({p.code_postal})</span>}
                {p.population ? <span className="text-muted-foreground font-normal"> · {p.population.toLocaleString("fr-FR")} hab.</span> : null}
              </div>
              <div className="text-sm">
                {p.contact_nom} — {p.fonction}
              </div>
              <div className="text-sm text-muted-foreground">
                {p.email}
                {p.telephone ? ` · ${p.telephone}` : ""} · {new Date(p.created_at).toLocaleString("fr-FR")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={p.status}
                onChange={(e) => setStatus(p.id, e.target.value as Pilot["status"])}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Statut"
              >
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={() => activate(p)} disabled={busy === p.id}>
                {busy === p.id && <Loader2 className="animate-spin" size={14} />} Activer le pilote
              </Button>
            </div>
          </div>
          {p.message && <p className="text-sm whitespace-pre-wrap bg-muted rounded-md p-2">{p.message}</p>}
        </Card>
      ))}
    </div>
  );
}
