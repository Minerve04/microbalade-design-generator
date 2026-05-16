import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Mail, Lock, Building2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";

type Mode = "login" | "signup";

export default function PartnerLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [collectivite, setCollectivite] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (mode === "signup" && !collectivite)) {
      toast.error("Merci de renseigner tous les champs");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard/commune`,
            data: { nom_collectivite: collectivite },
          },
        });
        if (error) throw error;
        toast.success("Compte créé ! Vérifiez votre email pour confirmer votre adresse.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bienvenue sur votre espace partenaire");
        navigate("/dashboard/commune", { replace: true });
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Espace partenaire — Microbalade</title>
        <meta name="description" content="Connectez-vous à votre espace partenaire Microbalade pour gérer votre territoire, vos statistiques et votre logo." />
        <link rel="canonical" href="https://microbalade.fr/partenaires/connexion" />
      </Helmet>

      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link to="/partenaires" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />
            <img src={logo} alt="Microbalade" className="h-7 w-auto" />
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="text-center space-y-2 mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-2">
              <ShieldCheck size={22} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              Espace <span className="text-primary">partenaire</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Réservé aux offices de tourisme et collectivités partenaires de Microbalade.
            </p>
          </div>

          <div className="bg-card border border-border rounded-3xl shadow-sm p-1 mb-6">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`py-2.5 text-sm font-semibold rounded-2xl transition-all ${
                  mode === "login" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"
                }`}
              >
                Connexion
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`py-2.5 text-sm font-semibold rounded-2xl transition-all ${
                  mode === "signup" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"
                }`}
              >
                Inscription
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-3xl shadow-sm p-6 md:p-8 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Nom de la collectivité
                </label>
                <div className="relative">
                  <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    required
                    value={collectivite}
                    onChange={(e) => setCollectivite(e.target.value)}
                    placeholder="Mairie de Saint-Omer"
                    className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Email professionnel
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@mairie-…fr"
                  className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Mot de passe
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  required
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-secondary rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {mode === "login" ? "Se connecter" : "Créer mon compte"}
            </button>

            <p className="text-[11px] text-muted-foreground text-center pt-2">
              Vos données sont hébergées en Europe et conformes au RGPD.
            </p>
          </form>
        </motion.div>
      </main>
    </div>
  );
}
