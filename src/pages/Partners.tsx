import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { ArrowLeft, Landmark, BarChart3, Store, Send, Loader2, CheckCircle2, Search, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import logo from "@/assets/logo.png";
import { useAuth } from "@/hooks/useAuth";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { getCommunePriceForPopulation } from "@/lib/stripe";

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
    title: "Zéro infrastructure\nZéro maintenance\nZéro publicité\n",
    description: "​",
  },
];

const Partners = () => {
  const [form, setForm] = useState({ name: "", role: "", organization: "", email: "", phone: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [population, setPopulation] = useState<number>(8000);
  const [communeQuery, setCommuneQuery] = useState("");
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openCheckout, closeCheckout, isOpen, checkoutElement } = useStripeCheckout();

  const pricing = useMemo(() => getPricing(population), [population]);

  const handleSubscribe = () => {
    const { priceId } = getCommunePriceForPopulation(population);
    if (!user) {
      toast.info("Connectez-vous pour finaliser l'abonnement");
      sessionStorage.setItem("pendingCheckoutPriceId", priceId);
      navigate(`/partenaires/connexion?intent=checkout&priceId=${encodeURIComponent(priceId)}`);
      return;
    }
    openCheckout({
      priceId,
      returnUrl: `${window.location.origin}/partenaires/paiement-confirme?session_id={CHECKOUT_SESSION_ID}`,
    });
  };

  const scrollToContact = () => {
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (communeQuery.trim()) {
      setForm((prev) => ({ ...prev, organization: prev.organization || communeQuery.trim() }));
    }
  };

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
          <div className="flex items-center gap-2 md:gap-3">
            <Link
              to="/partenaires/connexion"
              className="text-sm font-medium text-foreground/80 hover:text-foreground px-3 py-2 rounded-lg hover:bg-muted transition-colors"
            >
              Connexion
            </Link>
            <Link
              to="/partenaires/connexion"
              className="text-sm font-semibold bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-sm hover:shadow-md transition-all"
            >
              Inscription
            </Link>
          </div>
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
                <h3 className="text-lg font-semibold text-foreground whitespace-pre-line">{b.title}</h3>
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

        {/* Pricing estimator */}
        <section className="max-w-3xl mx-auto">
          <div className="text-center space-y-2 mb-8">
            <span className="inline-block text-xs font-semibold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">
              Estimation tarifaire
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-foreground">Combien pour ma commune ?</h2>
            <p className="text-muted-foreground text-sm">Faites glisser le curseur selon le nombre d'habitants.</p>
          </div>

          <div className="rounded-3xl border border-border bg-card shadow-sm p-6 md:p-10 space-y-8">
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">Votre commune peut rejoindre Microbalade pour</p>
              <p className="text-4xl md:text-6xl font-extrabold tracking-tight text-foreground leading-tight">
                {formatEuro(pricing.year)} € <span className="text-2xl md:text-3xl font-semibold text-muted-foreground">/ an</span>
              </p>
              {pricing.month !== null ? (
                <p className="text-base md:text-lg text-primary font-medium">
                  Soit seulement {pricing.month} € / mois
                </p>
              ) : (
                <p className="text-base md:text-lg text-muted-foreground">
                  Tarif sur-mesure pour les grandes métropoles
                </p>
              )}
            </div>

            <div className="space-y-4">
              <Slider
                value={[population]}
                onValueChange={(v) => setPopulation(v[0])}
                min={1000}
                max={SLIDER_MAX}
                step={1000}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground font-medium">
                <span>1 000 hab.</span>
                <span className="text-foreground text-sm font-semibold">
                  {population >= SLIDER_MAX ? "1 million et plus" : `${formatEuro(population)} habitants`}
                </span>
                <span>1 M+</span>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div className="relative">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={communeQuery}
                  onChange={(e) => setCommuneQuery(e.target.value)}
                  placeholder="Rechercher ma commune"
                  className="w-full bg-secondary rounded-xl pl-11 pr-4 py-3.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                type="button"
                onClick={handleSubscribe}
                className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-base"
              >
                {pricing.year >= 10000 ? "Demander un devis" : "S'abonner — " + formatEuro(pricing.year) + " € / an"}
                <ArrowRight size={18} />
              </button>
              <button
                type="button"
                onClick={scrollToContact}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                ou demander une démonstration sans engagement
              </button>
              <p className="text-[11px] text-muted-foreground text-center">
                Paiement par carte (immédiat) ou virement SEPA · Sans engagement de durée
              </p>
            </div>
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

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-start justify-center overflow-y-auto p-4">
          <div className="relative w-full max-w-2xl bg-card border border-border rounded-3xl shadow-2xl mt-8 mb-8">
            <button
              onClick={closeCheckout}
              className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-muted hover:bg-muted/70 flex items-center justify-center transition-colors"
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
            <div className="px-5 pt-12 pb-2 border-b border-border">
              <h2 className="text-lg font-bold text-foreground">Finaliser l'abonnement</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Paiement sécurisé par Stripe · Carte ou virement SEPA accepté
              </p>
            </div>
            <div className="p-2">{checkoutElement}</div>
          </div>
        </div>
      )}

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Microbalade ·{" "}
        <Link to="/confidentialite" className="hover:text-foreground">Confidentialité</Link> ·{" "}
        <Link to="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
      </footer>
    </div>
  );
};

export default Partners;
