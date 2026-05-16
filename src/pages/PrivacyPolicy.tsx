import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background px-5 py-10">
      <Helmet>
        <title>Politique de confidentialité — Microbalade</title>
        <meta
          name="description"
          content="Comment Microbalade traite vos données : géolocalisation, préférences de balade, services tiers (OpenStreetMap, Gemini, Google Maps) et droits RGPD."
        />
        <link rel="canonical" href="https://microbalade.fr/confidentialite" />
        <meta property="og:title" content="Politique de confidentialité — Microbalade" />
        <meta
          property="og:description"
          content="Données collectées, services tiers utilisés et vos droits RGPD sur Microbalade."
        />
        <meta property="og:url" content="https://microbalade.fr/confidentialite" />
        <meta property="og:type" content="article" />
      </Helmet>
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft size={16} />
          Retour
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <img src={logo} alt="Logo Microbalade" className="h-10 w-auto" />
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Politique de confidentialité
          </h1>
        </div>

        <div className="prose prose-sm max-w-none text-foreground space-y-6">
          <p className="text-sm text-muted-foreground">
            Dernière mise à jour : 5 mai 2026
          </p>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">1. Introduction</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Microbalade respecte votre vie privée. Cette politique explique quelles
              données nous collectons lorsque vous utilisez notre application de génération
              de micro-balades, et comment nous les utilisons.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">2. Données collectées</h2>
            <ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground space-y-1">
              <li>
                <strong>Localisation</strong> : si vous utilisez la géolocalisation, vos
                coordonnées GPS sont envoyées à OpenStreetMap (Nominatim) pour obtenir une
                adresse, puis à notre service pour générer un itinéraire. Elles ne sont
                pas stockées.
              </li>
              <li>
                <strong>Préférences de balade</strong> : durée et centres d'intérêt
                sélectionnés sont transmis à notre service de génération (basé sur Google
                Gemini) puis supprimés.
              </li>
              <li>
                <strong>Statistiques anonymes</strong> : nous utilisons Cloudflare Web
                Analytics, qui mesure l'audience sans cookies ni identifiants personnels.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">3. Cookies</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Microbalade n'utilise pas de cookies de suivi publicitaire. Aucune donnée
              n'est partagée avec des annonceurs.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">4. Services tiers</h2>
            <ul className="list-disc pl-5 text-sm leading-relaxed text-muted-foreground space-y-1">
              <li>OpenStreetMap / Nominatim — géocodage</li>
              <li>Google Gemini (via notre serveur) — génération d'itinéraires</li>
              <li>Google Maps — affichage des trajets</li>
              <li>Cloudflare — statistiques d'audience anonymes</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">5. Vos droits</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Conformément au RGPD, vous disposez d'un droit d'accès, de rectification et
              de suppression de vos données. Comme nous ne conservons pas de données
              personnelles, aucune action n'est généralement nécessaire.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">6. Contact</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Pour toute question concernant cette politique, vous pouvez nous contacter
              via le site microbalade.fr.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
