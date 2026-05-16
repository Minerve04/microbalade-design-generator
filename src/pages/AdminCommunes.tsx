import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, Plus, Save } from "lucide-react";

interface Commune {
  id: string;
  nom: string;
  code_postal: string;
  logo_url: string | null;
  active: boolean;
}

const PWD_KEY = "mb_admin_pwd";

const AdminCommunes = () => {
  const [password, setPassword] = useState<string>(() => sessionStorage.getItem(PWD_KEY) ?? "");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [form, setForm] = useState({ nom: "", code_postal: "", logo_url: "", active: true });

  const call = async (action: string, payload?: any) => {
    const { data, error } = await supabase.functions.invoke("admin-communes", {
      body: { password, action, payload },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
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

  useEffect(() => {
    if (password && !authed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!form.nom || !form.code_postal) {
      toast.error("Nom et code postal requis");
      return;
    }
    try {
      await call("create", form);
      setForm({ nom: "", code_postal: "", logo_url: "", active: true });
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

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-6 w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">Admin — Communes partenaires</h1>
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
    <div className="min-h-screen bg-background p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Communes partenaires</h1>

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
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Logo URL</Label>
            <Input
              value={form.logo_url}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
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
                <Label>Logo URL</Label>
                <Input
                  value={c.logo_url ?? ""}
                  onChange={(e) => updateLocal(c.id, { logo_url: e.target.value })}
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
            {c.logo_url && (
              <img
                src={c.logo_url}
                alt={`Logo ${c.nom}`}
                className="h-12 object-contain"
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminCommunes;
