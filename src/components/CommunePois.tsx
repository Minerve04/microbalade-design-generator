import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const POI_CATEGORIES = [
  { value: "patrimoine", label: "Patrimoine" },
  { value: "nature", label: "Nature" },
  { value: "street_art", label: "Street art" },
  { value: "commerce", label: "Commerce" },
  { value: "autre", label: "Autre" },
] as const;

export interface CommunePoi {
  id: string;
  nom: string;
  description: string;
  categorie: string;
  lat: number;
  lon: number;
  url_source: string | null;
  active: boolean;
}

type Draft = Omit<CommunePoi, "id"> & { id?: string };

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:9999px;background:hsl(var(--primary));border:3px solid hsl(var(--background));box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const ClickPicker = ({ onPick }: { onPick: (lat: number, lon: number) => void }) => {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
};
const Recenter = ({ lat, lon }: { lat: number; lon: number }) => {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon], Math.max(map.getZoom(), 16));
  }, [lat, lon, map]);
  return null;
};

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

interface Props {
  userId: string;
  codePostal: string | null;
  communeName: string;
}

export default function CommunePois({ userId, codePostal, communeName }: Props) {
  const [items, setItems] = useState<CommunePoi[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [center, setCenter] = useState<[number, number]>([50.75, 2.25]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("commune_pois")
      .select("id, nom, description, categorie, lat, lon, url_source, active")
      .eq("commune_user_id", userId)
      .order("nom");
    if (error) toast.error("Impossible de charger vos lieux.");
    setItems((data as CommunePoi[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (codePostal || communeName) {
      fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(`${codePostal ?? ""} ${communeName}`)}&limit=1&type=municipality`)
        .then((r) => r.json())
        .then((d) => {
          const c = d?.features?.[0]?.geometry?.coordinates;
          if (c) setCenter([c[1], c[0]]);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const startNew = () => {
    setAddress("");
    setDraft({ nom: "", description: "", categorie: "patrimoine", lat: center[0], lon: center[1], url_source: "", active: true });
  };

  const searchAddress = async () => {
    if (!address.trim() || !draft) return;
    setSearching(true);
    try {
      const q = `${address} ${codePostal ?? ""}`.trim();
      const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=1`);
      const d = await r.json();
      const c = d?.features?.[0]?.geometry?.coordinates;
      if (!c) toast.error("Adresse introuvable.");
      else setDraft({ ...draft, lat: c[1], lon: c[0] });
    } catch {
      toast.error("Recherche d'adresse indisponible.");
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!codePostal) return toast.error("Renseignez d'abord le code postal de votre commune (onglet Profil).");
    if (!draft.nom.trim()) return toast.error("Le nom du lieu est requis.");
    if (draft.description.length > 800) return toast.error("La description ne doit pas dépasser 800 caractères.");
    const url = (draft.url_source ?? "").trim();
    if (url && !isHttpUrl(url)) return toast.error("Le lien source doit commencer par http:// ou https://");
    setSaving(true);
    const row = {
      nom: draft.nom.trim(),
      description: draft.description.trim(),
      categorie: draft.categorie,
      lat: draft.lat,
      lon: draft.lon,
      url_source: url || null,
      active: draft.active,
    };
    const { error } = draft.id
      ? await supabase.from("commune_pois").update(row).eq("id", draft.id)
      : await supabase.from("commune_pois").insert({ ...row, commune_user_id: userId, code_postal: codePostal });
    setSaving(false);
    if (error) return toast.error("Enregistrement refusé : vérifiez que votre abonnement est actif.");
    toast.success("Lieu enregistré");
    setDraft(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce lieu ?")) return;
    const { error } = await supabase.from("commune_pois").delete().eq("id", id);
    if (error) return toast.error("Suppression impossible.");
    setItems((l) => l.filter((x) => x.id !== id));
  };

  const inputCls = "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <section className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">Mes lieux</h1>
          <p className="text-sm text-muted-foreground">
            Ces lieux et leurs descriptions sont prioritaires dans les balades générées sur votre territoire.
          </p>
        </div>
        {!draft && (
          <button onClick={startNew} className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2.5 rounded-xl shrink-0">
            <Plus size={16} /> Ajouter un lieu
          </button>
        )}
      </div>

      {draft && (
        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-foreground">{draft.id ? "Modifier le lieu" : "Nouveau lieu"}</h2>
            <button onClick={() => setDraft(null)} aria-label="Fermer" className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 text-sm font-medium">
              Nom du lieu
              <input className={inputCls} value={draft.nom} maxLength={200} onChange={(e) => setDraft({ ...draft, nom: e.target.value })} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Catégorie
              <select className={inputCls} value={draft.categorie} onChange={(e) => setDraft({ ...draft, categorie: e.target.value })}>
                {POI_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">
            Description validée par la commune
            <textarea className={`${inputCls} min-h-[110px]`} maxLength={800} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <span className="block text-xs text-muted-foreground text-right">{draft.description.length}/800</span>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            Lien source (optionnel)
            <input className={inputCls} placeholder="https://" value={draft.url_source ?? ""} onChange={(e) => setDraft({ ...draft, url_source: e.target.value })} />
          </label>

          <div className="space-y-2">
            <p className="text-sm font-medium">Position</p>
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Tapez une adresse…" value={address} onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchAddress())} />
              <button onClick={searchAddress} className="px-4 rounded-xl border border-border text-sm font-medium inline-flex items-center gap-1.5">
                {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Placer
              </button>
            </div>
            <p className="text-xs text-muted-foreground">…ou cliquez sur la carte pour placer le point.</p>
            <div className="h-56 rounded-xl overflow-hidden border border-border">
              <MapContainer center={[draft.lat, draft.lon]} zoom={15} className="h-full w-full">
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[draft.lat, draft.lon]} icon={pinIcon} />
                <ClickPicker onPick={(lat, lon) => setDraft((d) => (d ? { ...d, lat, lon } : d))} />
                <Recenter lat={draft.lat} lon={draft.lon} />
              </MapContainer>
            </div>
            <p className="text-xs text-muted-foreground">{draft.lat.toFixed(5)}, {draft.lon.toFixed(5)}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            Lieu actif (utilisé dans les balades)
          </label>

          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-5 py-3 rounded-xl disabled:opacity-60">
            {saving && <Loader2 size={16} className="animate-spin" />} Enregistrer
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl divide-y divide-border">
        {loading ? (
          <div className="p-6 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Aucun lieu pour l'instant.</p>
        ) : (
          items.map((p) => (
            <div key={p.id} className="p-4 flex items-start gap-3">
              <MapPin size={18} className="text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground text-sm">
                  {p.nom}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {POI_CATEGORIES.find((c) => c.value === p.categorie)?.label ?? p.categorie}
                    {!p.active && " · inactif"}
                  </span>
                </p>
                {p.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.description}</p>}
              </div>
              <button onClick={() => { setAddress(""); setDraft({ ...p, url_source: p.url_source ?? "" }); }} aria-label="Modifier" className="p-2 text-muted-foreground hover:text-foreground"><Pencil size={16} /></button>
              <button onClick={() => remove(p.id)} aria-label="Supprimer" className="p-2 text-muted-foreground hover:text-destructive"><Trash2 size={16} /></button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
