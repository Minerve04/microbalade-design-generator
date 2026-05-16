import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  email: string;
  nomCollectivite: string;
  prixAnnuel: number;
  formuleLabel: string;
  initial?: {
    siret?: string | null;
    numero_engagement?: string | null;
    code_service_chorus?: string | null;
    adresse_facturation?: string | null;
    email_comptabilite?: string | null;
  };
  onSuccess?: () => void;
}

export function ChorusRequestDialog({
  open,
  onOpenChange,
  userId,
  email,
  nomCollectivite,
  prixAnnuel,
  formuleLabel,
  initial,
  onSuccess,
}: Props) {
  const [siret, setSiret] = useState(initial?.siret ?? "");
  const [numeroEngagement, setNumeroEngagement] = useState(initial?.numero_engagement ?? "");
  const [codeService, setCodeService] = useState(initial?.code_service_chorus ?? "");
  const [adresseFacturation, setAdresseFacturation] = useState(initial?.adresse_facturation ?? "");
  const [emailCompta, setEmailCompta] = useState(initial?.email_comptabilite ?? email);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!/^\d{14}$/.test(siret.replace(/\s/g, ""))) {
      toast.error("SIRET invalide (14 chiffres attendus)");
      return;
    }
    if (!adresseFacturation.trim()) {
      toast.error("Adresse de facturation requise");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCompta)) {
      toast.error("Email comptabilité invalide");
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date();
      const due = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const { error } = await supabase
        .from("commune_profiles")
        .update({
          siret: siret.replace(/\s/g, ""),
          numero_engagement: numeroEngagement || null,
          code_service_chorus: codeService || null,
          adresse_facturation: adresseFacturation,
          email_comptabilite: emailCompta,
          mode_paiement: "chorus",
          status_abonnement: "en_attente_mandat",
          chorus_status: "pending",
          chorus_requested_at: now.toISOString(),
          chorus_due_date: due.toISOString().slice(0, 10),
        })
        .eq("user_id", userId);
      if (error) throw error;
      toast.success("Demande enregistrée — votre compte est activé. Vous recevrez la facture par email.");
      onSuccess?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erreur lors de l'enregistrement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} /> Règlement par bon de commande (Chorus Pro)
          </DialogTitle>
          <DialogDescription>
            {formuleLabel} — {prixAnnuel} € / an. Votre compte sera activé immédiatement. La facture vous sera envoyée sur Chorus Pro, à régler sous 30 jours.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label htmlFor="siret">SIRET de la collectivité *</Label>
            <Input
              id="siret"
              value={siret}
              onChange={(e) => setSiret(e.target.value)}
              placeholder="14 chiffres"
              maxLength={17}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="engagement">N° d'engagement</Label>
              <Input
                id="engagement"
                value={numeroEngagement}
                onChange={(e) => setNumeroEngagement(e.target.value)}
                placeholder="Optionnel"
              />
            </div>
            <div>
              <Label htmlFor="code-service">Code service</Label>
              <Input
                id="code-service"
                value={codeService}
                onChange={(e) => setCodeService(e.target.value)}
                placeholder="Optionnel"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="adresse">Adresse de facturation *</Label>
            <Textarea
              id="adresse"
              value={adresseFacturation}
              onChange={(e) => setAdresseFacturation(e.target.value)}
              placeholder="Mairie de…&#10;Adresse complète&#10;Code postal et ville"
              rows={3}
            />
          </div>
          <div>
            <Label htmlFor="email-compta">Email du service comptabilité *</Label>
            <Input
              id="email-compta"
              type="email"
              value={emailCompta}
              onChange={(e) => setEmailCompta(e.target.value)}
              placeholder="compta@mairie-…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Bénéficiaire : <strong>Microbalade</strong> — la facture émise vous parviendra par email et sera également déposée sur votre Chorus Pro à réception du n° d'engagement.
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Activer mon compte
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
