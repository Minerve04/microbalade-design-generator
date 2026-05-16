import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { ArrowLeft, Landmark, BarChart3, Store, Send, Loader2, CheckCircle2, Search, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import logo from "@/assets/logo.png";

const SLIDER_MAX = 1_000_001; // sentinel for "1 million et plus"

function getPricing(pop: number) {
  if (pop >= SLIDER_MAX) return { year: 50000, month: null, label: "1 million d'habitants ou plus" };
  if (pop >= 250_000) return { year: 10000, month: null, label: `${pop.toLocaleString("fr-FR")} habitants` };
  if (pop >= 100_000) return { year: 6000, month: 500, label: `${pop.toLocaleString("fr-FR")} habitants` };
  if (pop >= 50_000) return { year: 3000, month: 250, label: `${pop.toLocaleString("fr-FR")} habitants` };
  if (pop >= 20_000) return { year: 1500, month: 125, label: `${pop.toLocaleString("fr-FR")} habitants` };
  if (pop >= 10_000) return { year: 600, month: 50, label: `${pop.toLocaleString("fr-FR")} habitants` };
  return { year: 300, month: 25, label: `${pop.toLocaleString("fr-FR")} habitants` };
}

function formatEuro(n: number) {
  return n.toLocaleString("fr-FR");
}

const benefits = [
  {
    icon: Landmark,
    title: "Valorisation du patrimoine",
    description:
      "Mettez en lumière les trésors méconnus de votre commune : ruelles oubliées, anecdotes locales, monuments d'exception. Microbalade transforme chaque coin de rue en récit vivant.",
  },
  {
    icon: BarChart3,
    title: "Statistiques de fréquentation",
    description:
      "Accédez à un tableau de bord détaillé : nombre de balades générées, parcours plébiscités, horaires de pointe, profils des visiteurs. Pilotez votre stratégie touristique avec des données concrètes.",
  },
  {
    icon: Store,
    title: "Redirection vers les commerces",
    description:
      "Intégrez les artisans, restaurants et boutiques locales dans les itinéraires. Microbalade devient un véritable levier économique pour dynamiser votre centre-ville.",
  },
];

const Partners = () => {
  const [form, setForm] = useState({ name: "", role: "", organization: "", email: "", phone: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.organization.trim()) {
      toast.error("Merci de renseigner les champs obligatoires");
      return;
    }
    setLoading(true);
    const subject = encodeURIComponent(`Demande de démonstration Microbalade — ${form.organization}`);
    const body = encodeURIComponent(
      `Nom : ${form.name}\nFonction : ${form.role}\nOrganisation : ${form.organization}\nEmail : ${form.email}\nTéléphone : ${form.phone}\n\nMessage :\n${form.message}`
    );
    window.location.href = `mailto:contact@microbalade.fr?subject=${subject}&body=${body}`;
    setTimeout(() => {
      setLoading(false);
      setSent(true);
      toast.success("Votre demande a été préparée. Merci !");
    }, 600);
  };

  const updateField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Partenaires — Microbalade pour offices de tourisme et mairies</title>
        <meta
          name="description"
          content="Microbalade accompagne les offices de tourisme et mairies pour valoriser leur patrimoine, mesurer la fréquentation et soutenir les commerces locaux. Demandez une démonstration."
        />
        <link rel="canonical" href="https://microbalade.fr/partenaires" />
      </Helmet>

      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />
            <img src={logo} alt="Microbalade" className="h-7 w-auto" />
          </Link>
          <a
            href="#contact"
            className="text-sm font-medium text-primary hover:underline"
          >
            Demander une démo
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-12 md:py-20 space-y-20">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto space-y-5"
        >
          <span className="inline-block text-xs font-semibold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">
            Pour les territoires
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
            Faites rayonner votre <span className="text-primary">territoire</span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Microbalade est l'outil clé en main pour les offices de tourisme et les mairies qui souhaitent
            offrir à leurs visiteurs une découverte personnalisée, mesurable et utile à l'économie locale.
          </p>
        </motion.section>

        {/* Benefits */}
        <section className="space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">Pourquoi devenir partenaire ?</h2>
            <p className="text-muted-foreground">Trois leviers concrets pour votre commune.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {benefits.map((b, i) => (
              <motion.article
                key={b.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="glass-card rounded-2xl p-6 space-y-3"
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <b.icon size={22} />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{b.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{b.description}</p>
              </motion.article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="glass-card rounded-3xl p-8 md:p-12 space-y-6">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground text-center">Une mise en place simple</h2>
          <div className="grid md:grid-cols-3 gap-6 pt-2">
            {[
              { n: "01", t: "Échange initial", d: "Nous découvrons ensemble vos enjeux et le périmètre de votre territoire." },
              { n: "02", t: "Personnalisation", d: "Vos points d'intérêt, anecdotes et commerces sont intégrés au générateur." },
              { n: "03", t: "Déploiement", d: "Vos visiteurs accèdent à Microbalade depuis votre site, vos QR codes ou vos supports print." },
            ].map((s) => (
              <div key={s.n} className="space-y-2">
                <div className="text-3xl font-extrabold text-primary">{s.n}</div>
                <h3 className="font-semibold text-foreground">{s.t}</h3>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Contact form */}
        <section id="contact" className="max-w-2xl mx-auto space-y-6 scroll-mt-20">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">Demandez une démonstration</h2>
            <p className="text-muted-foreground">
              Élus, agents, responsables tourisme : laissez-nous vos coordonnées, nous vous recontactons sous 48h.
            </p>
          </div>

          {sent ? (
            <div className="glass-card rounded-2xl p-8 text-center space-y-3">
              <CheckCircle2 size={40} className="mx-auto text-primary" />
              <p className="font-semibold text-foreground">Merci pour votre demande</p>
              <p className="text-sm text-muted-foreground">
                Si votre messagerie ne s'est pas ouverte, écrivez-nous directement à{" "}
                <a href="mailto:contact@microbalade.fr" className="text-primary hover:underline">
                  contact@microbalade.fr
                </a>
                .
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="glass-card rounded-2xl p-6 md:p-8 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nom *</label>
                  <input
                    required
                    value={form.name}
                    onChange={updateField("name")}
                    className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fonction</label>
                  <input
                    value={form.role}
                    onChange={updateField("role")}
                    placeholder="Maire, adjoint, directeur OT…"
                    className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Commune / Office *
                </label>
                <input
                  required
                  value={form.organization}
                  onChange={updateField("organization")}
                  className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={updateField("email")}
                    className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Téléphone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={updateField("phone")}
                    className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Message</label>
                <textarea
                  rows={4}
                  value={form.message}
                  onChange={updateField("message")}
                  placeholder="Parlez-nous de votre projet…"
                  className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                Envoyer ma demande
              </button>
              <p className="text-[11px] text-muted-foreground text-center">
                Vos informations restent confidentielles et ne sont utilisées que pour vous recontacter.
              </p>
            </form>
          )}
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Microbalade ·{" "}
        <Link to="/confidentialite" className="hover:text-foreground">Confidentialité</Link> ·{" "}
        <Link to="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
      </footer>
    </div>
  );
};

export default Partners;
