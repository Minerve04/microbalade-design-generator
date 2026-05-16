import { useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, Send, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/logo.png";

const Contact = () => {
  const [form, setForm] = useState({ name: "", role: "", organization: "", email: "", phone: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const updateField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.organization.trim()) {
      toast.error("Merci de renseigner les champs obligatoires");
      return;
    }
    setLoading(true);
    const idempotencyKey = crypto.randomUUID();
    try {
      const { error: notifyError } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "contact-notification",
          recipientEmail: "contact@microbalade.com",
          idempotencyKey: `contact-notify-${idempotencyKey}`,
          templateData: { ...form },
        },
      });
      if (notifyError) throw notifyError;
      await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "contact-confirmation",
          recipientEmail: form.email,
          idempotencyKey: `contact-confirm-${idempotencyKey}`,
          templateData: { name: form.name },
        },
      });
      setSent(true);
      toast.success("Votre message a bien été envoyé. Merci !");
    } catch (err) {
      console.error(err);
      toast.error("Impossible d'envoyer le message. Réessayez plus tard.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Contact — Microbalade</title>
        <meta name="description" content="Contactez l'équipe Microbalade pour toute question ou demande d'information." />
        <link rel="canonical" href="https://microbalade.fr/contact" />
      </Helmet>

      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link to="/partenaires" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />
            <img src={logo} alt="Microbalade" className="h-7 w-auto" />
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-12 md:py-20 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground">Contactez-nous</h1>
          <p className="text-muted-foreground">
            Une question ? Laissez-nous vos coordonnées, nous vous répondons sous 48h.
          </p>
        </div>

        {sent ? (
          <div className="glass-card rounded-2xl p-8 text-center space-y-3">
            <CheckCircle2 size={40} className="mx-auto text-primary" />
            <p className="font-semibold text-foreground">Merci pour votre message</p>
            <p className="text-sm text-muted-foreground">
              Nous revenons vers vous sous 48h. Vous pouvez aussi nous joindre à{" "}
              <a href="mailto:contact@microbalade.com" className="text-primary hover:underline">
                contact@microbalade.com
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
              Envoyer
            </button>
            <p className="text-[11px] text-muted-foreground text-center">
              Vos informations restent confidentielles et ne sont utilisées que pour vous recontacter.
            </p>
          </form>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Microbalade ·{" "}
        <Link to="/confidentialite" className="hover:text-foreground">Confidentialité</Link> ·{" "}
        <Link to="/mentions-legales" className="hover:text-foreground">Mentions légales</Link>
      </footer>
    </div>
  );
};

export default Contact;
