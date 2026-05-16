import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Helmet } from "react-helmet-async";
import logo from "@/assets/logo.png";

export default function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Confirmation de paiement — Microbalade</title>
      </Helmet>
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-5 py-3">
          <Link to="/" className="inline-flex items-center">
            <img src={logo} alt="Microbalade" className="h-7 w-auto" />
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="max-w-md w-full text-center space-y-6 glass-card rounded-3xl p-10">
          <CheckCircle2 size={64} className="mx-auto text-primary" />
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-foreground">Merci, votre paiement est enregistré</h1>
            <p className="text-sm text-muted-foreground">
              {sessionId
                ? "Nous activons votre accès partenaire dès la confirmation de votre paiement (instantané par carte, sous 1 à 5 jours par virement SEPA)."
                : "Aucune session de paiement détectée."}
            </p>
          </div>
          <Link
            to="/dashboard/commune"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl transition-all"
          >
            Accéder à mon Dashboard
            <ArrowRight size={18} />
          </Link>
        </div>
      </main>
    </div>
  );
}
