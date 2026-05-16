import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "valid" | "already" | "invalid" | "done" | "error">("loading");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    fetch(`${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, {
      headers: { apikey: SUPABASE_ANON },
    })
      .then(async (r) => {
        const data = await r.json();
        if (data.valid) setState("valid");
        else if (data.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      })
      .catch(() => setState("error"));
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    setSubmitting(false);
    if (error) setState("error");
    else if (data?.success || data?.reason === "already_unsubscribed") setState("done");
    else setState("error");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5">
      <Helmet><title>Désabonnement — Microbalade</title></Helmet>
      <div className="max-w-md w-full text-center space-y-4 p-8 rounded-2xl bg-secondary">
        {state === "loading" && <Loader2 className="animate-spin mx-auto text-primary" size={32} />}
        {state === "valid" && (
          <>
            <h1 className="text-xl font-bold text-foreground">Confirmer le désabonnement</h1>
            <p className="text-sm text-muted-foreground">Vous ne recevrez plus d'emails de Microbalade.</p>
            <button onClick={handleConfirm} disabled={submitting} className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-xl">
              {submitting ? "..." : "Me désabonner"}
            </button>
          </>
        )}
        {state === "already" && <><CheckCircle2 className="mx-auto text-primary" size={32} /><p>Vous êtes déjà désabonné.</p></>}
        {state === "done" && <><CheckCircle2 className="mx-auto text-primary" size={32} /><p>Désabonnement confirmé.</p></>}
        {state === "invalid" && <><XCircle className="mx-auto text-destructive" size={32} /><p>Lien invalide ou expiré.</p></>}
        {state === "error" && <><XCircle className="mx-auto text-destructive" size={32} /><p>Une erreur est survenue.</p></>}
      </div>
    </div>
  );
};

export default Unsubscribe;
