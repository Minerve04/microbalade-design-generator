import { MapPin, Navigation, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  {
    title: "La Cour des Miracles",
    description:
      "Commencez par cette ancienne cour cachée, autrefois refuge des marginaux de Paris. Les façades médiévales racontent une histoire fascinante de résilience urbaine.",
  },
  {
    title: "Le Passage du Désir",
    description:
      "Empruntez ce passage couvert du XIXe siècle, orné de mosaïques oubliées et de vitraux Art Nouveau. Un véritable voyage dans le temps en plein cœur de la ville.",
  },
  {
    title: "Le Jardin Suspendu",
    description:
      "Terminez votre balade dans ce jardin secret perché sur un ancien viaduc. Une oasis de verdure avec une vue imprenable sur les toits parisiens.",
  },
];

interface ResultScreenProps {
  onBack: () => void;
}

const ResultScreen = ({ onBack }: ResultScreenProps) => {
  return (
    <div className="min-h-screen bg-background flex flex-col pb-8">
      {/* Map placeholder */}
      <div className="relative w-full h-56 bg-secondary overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <MapPin size={32} className="text-primary" />
            <span className="text-sm font-medium">Carte interactive</span>
          </div>
        </div>
        {/* Decorative dots for map feel */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.5" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
        {/* Back button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          className="absolute top-4 left-4 bg-card/90 backdrop-blur-md rounded-full p-2.5 shadow-sm border border-border/50"
        >
          <ArrowLeft size={20} className="text-foreground" />
        </motion.button>
      </div>

      {/* Content */}
      <div className="px-5 -mt-4 relative z-10 flex flex-col gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-card rounded-2xl p-5"
        >
          <h2 className="text-lg font-bold text-foreground mb-1">Votre Microbalade</h2>
          <p className="text-sm text-muted-foreground">3 étapes · ~30 min à pied</p>
        </motion.div>

        {/* Steps */}
        <div className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 * (index + 1) }}
              className="glass-card rounded-2xl p-5"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">{index + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-foreground mb-1.5">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Google Maps CTA */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5 }}
          whileTap={{ scale: 0.97 }}
          className="w-full flex items-center justify-center gap-2.5 bg-primary text-primary-foreground font-semibold text-base py-4 rounded-2xl shadow-lg shadow-primary/25 mt-2"
        >
          <Navigation size={18} />
          Ouvrir l'itinéraire dans Google Maps
        </motion.button>
      </div>
    </div>
  );
};

export default ResultScreen;
