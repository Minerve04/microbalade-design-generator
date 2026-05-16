import { loadStripe, type Stripe } from "@stripe/stripe-js";

type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;
const environment: StripeEnv = clientToken?.startsWith("pk_test_") ? "sandbox" : "live";

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (!clientToken) {
      throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");
    }
    stripePromise = loadStripe(clientToken);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return environment;
}

// Map population (slider value) to the corresponding Stripe price ID and price.
export function getCommunePriceForPopulation(pop: number): {
  priceId: string;
  amountEur: number;
  label: string;
} {
  if (pop >= 250_000) return { priceId: "commune_metropole_xl_year", amountEur: 10000, label: "Grande métropole" };
  if (pop >= 100_000) return { priceId: "commune_metropole_year", amountEur: 6000, label: "Métropole" };
  if (pop >= 50_000) return { priceId: "commune_grande_ville_year", amountEur: 3000, label: "Grande ville" };
  if (pop >= 20_000) return { priceId: "commune_ville_moyenne_year", amountEur: 1500, label: "Ville moyenne" };
  if (pop >= 10_000) return { priceId: "commune_petite_ville_year", amountEur: 600, label: "Petite ville" };
  return { priceId: "commune_village_year", amountEur: 300, label: "Village" };
}

// Reverse map : retrouve le priceId à partir du prix annuel stocké sur le profil commune.
export function getCommunePriceIdFromAmount(amountEur: number): string {
  if (amountEur >= 10000) return "commune_metropole_xl_year";
  if (amountEur >= 6000) return "commune_metropole_year";
  if (amountEur >= 3000) return "commune_grande_ville_year";
  if (amountEur >= 1500) return "commune_ville_moyenne_year";
  if (amountEur >= 600) return "commune_petite_ville_year";
  return "commune_village_year";
}
