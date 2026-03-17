import { useState } from "react";
import HomeScreen from "@/components/HomeScreen";
import ResultScreen from "@/components/ResultScreen";

const Index = () => {
  const [showResult, setShowResult] = useState(false);

  return showResult ? (
    <ResultScreen onBack={() => setShowResult(false)} />
  ) : (
    <HomeScreen onGenerate={() => setShowResult(true)} />
  );
};

export default Index;
