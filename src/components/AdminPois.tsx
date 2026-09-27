import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Poi {
  id: string;
  nom: string;
  description: string;
  categorie: string;
  code_postal: string;
  lat: number;
  lon: number;
  url_source: string | null;
  active: boolean;
  commune_user_id: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function AdminPois({ call }: { call: (action: string, payload?: any) => Promise<any> }) {
  const [cp, setCp] = useState("");
  const [items, setItems] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await call("list_pois", { code_postal: cp.trim() || undefined });
      setItems(res.data ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const update = async (id: string, fields: Partial<Poi>) => {
    try {
      const res = await call("update_poi", { id, ...fields });
      setItems((l) => l.map((p) => (p.id === id ? res.data : p)));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce lieu ?")) return;
    try {
      await call("delete_poi", { id });
      setItems((l) => l.filter((p) => p.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-4 flex gap-3 items-end">
        <div className="flex-1">
          <Label>Code postal (vide = toutes les communes)</Label>
          <Input value={cp} onChange={(e) => setCp(e.target.value)} placeholder="62500" />
        </div>
        <Button onClick={load} disabled={loading}>{loading ? "Chargement…" : "Afficher"}</Button>
      </Card>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Aucun lieu.</p>}
      {items.map((p) => (
        <Card key={p.id} className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{p.nom} <span className="text-xs text-muted-foreground font-normal">· {p.categorie} · {p.code_postal}</span></p>
              <p className="text-xs text-muted-foreground">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}{p.url_source && <> · <a className="underline" href={p.url_source} target="_blank" rel="noopener noreferrer">source</a></>}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Switch checked={p.active} onCheckedChange={(v) => update(p.id, { active: v })} />
              <Button variant="destructive" size="sm" onClick={() => remove(p.id)}>Supprimer</Button>
            </div>
          </div>
          <textarea
            className="w-full text-sm border border-border rounded-md p-2 bg-background"
            defaultValue={p.description}
            maxLength={800}
            onBlur={(e) => e.target.value !== p.description && update(p.id, { description: e.target.value })}
          />
        </Card>
      ))}
    </div>
  );
}
