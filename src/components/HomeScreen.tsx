import { useState } from "react";
import { MapPin, Loader2, LocateFixed } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const interests = [
  { id: "architecture", emoji: "🏛️", label: "Architecture" },
  { id: "nature", emoji: "🌳", label: "Nature" },
  { id: "streetart", emoji: "🎨", label: "Street-art" },
  { id: "history", emoji: "👻", label: "Histoire insolite" },
];

interface HomeScreenProps {
  onGenerate: (data: { location: string; duration: number; interests: string[] }) => void;
  loading?: boolean;
}

const HomeScreen = ({ onGenerate, loading }: HomeScreenProps) => {
  const [location, setLocation] = useState("");
  const [duration, setDuration] = useState(30);
  const [selected, setSelected] = useState<string[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      toast.error("La géolocalisation n'est pas supportée par votre navigateur");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=fr`
          );
          const data = await res.json();
          const parts = [
            data.address?.road,
            data.address?.city || data.address?.town || data.address?.village,
          ].filter(Boolean);
          setLocation(parts.join(", ") || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        } catch {
          setLocation(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
        } finally {
          setGeoLoading(false);
        }
      },
      () => {
        toast.error("Impossible d'obtenir votre position");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const toggleInterest = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const formatDuration = (min: number) => {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-5 py-12 pb-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md flex flex-col gap-8"
      >
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
            Micro<span className="text-primary">balade</span>
          </h1>
          <p className="text-muted-foreground text-base">
            Transformez votre attente en découverte
          </p>
        </div>

        <div className="glass-card rounded-2xl p-4">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
            Localisation
          </label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-primary" size={20} />
            <input
              type="text"
              placeholder="Où êtes-vous ?"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-secondary rounded-xl pl-11 pr-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all text-sm"
            />
          </div>
        </div>

        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Temps disponible
            </label>
            <span className="text-sm font-bold text-primary">{formatDuration(duration)}</span>
          </div>
          <input
            type="range"
            min={15}
            max={120}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md"
          />
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-muted-foreground">15 min</span>
            <span className="text-[10px] text-muted-foreground">2h</span>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Envie du moment
          </label>
          <div className="grid grid-cols-2 gap-3">
            {interests.map((item) => {
              const active = selected.includes(item.id);
              return (
                <motion.button
                  key={item.id}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => toggleInterest(item.id)}
                  className={`flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-sm font-medium transition-all border ${
                    active
                      ? "bg-primary/10 border-primary/30 text-foreground"
                      : "glass-card text-muted-foreground hover:border-border"
                  }`}
                >
                  <span className="text-lg">{item.emoji}</span>
                  <span>{item.label}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={loading}
          onClick={() => onGenerate({ location, duration, interests: selected })}
          className="w-full bg-primary text-primary-foreground font-semibold text-base py-4 rounded-2xl shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all active:shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Génération en cours…
            </>
          ) : (
            "Générer ma Microbalade"
          )}
        </motion.button>
      </motion.div>
    </div>
  );
};

export default HomeScreen;
