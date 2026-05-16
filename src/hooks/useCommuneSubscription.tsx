import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type CommuneStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete";

export function useCommuneSubscription() {
  const { user } = useAuth();
  const [status, setStatus] = useState<CommuneStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!user) {
      setStatus(null);
      setLoading(false);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("commune_profiles")
        .select("status_abonnement")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!mounted) return;
      setStatus(((data?.status_abonnement as CommuneStatus | undefined) ?? "trialing"));
      setLoading(false);
    })();

    const channel = supabase
      .channel(`commune-status-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "commune_profiles",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const next = (payload.new as { status_abonnement?: CommuneStatus })?.status_abonnement;
          if (next) setStatus(next);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const isActive = status === "active" || status === "trialing";
  return { status, isActive, loading };
}
