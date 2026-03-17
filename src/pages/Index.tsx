import { useState } from "react";
import { toast } from "sonner";
import HomeScreen from "@/components/HomeScreen";
import ResultScreen, { BaladeResult } from "@/components/ResultScreen";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const [result, setResult] = useState<BaladeResult | null>(null);
  const [duration, setDuration] = useState(30);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async (data: { location: string; duration: number; interests: string[] }) => {
    if (!data.location.trim()) {
      toast.error("Veuillez indiquer votre localisation");
      return;
    }
    if (data.interests.length === 0) {
      toast.error("Choisissez au moins un centre d'intérêt");
      return;
    }

    setDuration(data.duration);
    setLoading(true);

    try {
      const { data: fnData, error } = await supabase.functions.invoke("generate-balade", {
        body: { location: data.location, duration: data.duration, interests: data.interests },
      });

      if (error) throw error;
      if (fnData?.error) throw new Error(fnData.error);

      setResult(fnData as BaladeResult);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Erreur lors de la génération");
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return <ResultScreen result={result} duration={duration} onBack={() => setResult(null)} />;
  }

  return <HomeScreen onGenerate={handleGenerate} loading={loading} />;
};

export default Index;
