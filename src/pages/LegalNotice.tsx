import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

const LegalNotice = () => {
  return (
    <div className="min-h-screen bg-background px-5 py-10">
      <Helmet>
        <title>Mentions légales — Microbalade</title>
        <meta
          name="description"
          content="Mentions légales de Microbalade : éditeur, hébergement, propriété intellectuelle et contact."
        />
        <link rel="canonical" href="https://microbalade.fr/mentions-legales" />
        <meta property="og:title" content="Mentions légales — Microbalade" />
        <meta
          property="og:description"
          content="Informations légales relatives au site Microbalade."
        />
        <meta property="og:url" content="https://microbalade.fr/mentions-legales" />
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
            Mentions légales
          </h1>
        </div>

        <div className="prose prose-sm max-w-none text-foreground space-y-6">
          <p className="text-sm text-muted-foreground">
            Dernière mise à jour : 16 mai 2026
          </p>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">1. Éditeur du site</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Le site Microbalade est édité par Microbalade, accessible à l'adresse
              <a href="https://microbalade.fr" className="text-primary hover:underline"> https://microbalade.fr</a>.
              Pour toute question, vous pouvez nous contacter via le site.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">2. Directeur de la publication</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Le directeur de la publication est le responsable éditorial de Microbalade.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">3. Hébergement</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Le site est hébergé par Lovable et Cloudflare. L'infrastructure backend
              (base de données, fonctions serveur) est fournie via Lovable Cloud.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">4. Propriété intellectuelle</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              L'ensemble des contenus présents sur le site Microbalade (textes,
              illustrations, logo, code, itinéraires générés) est protégé par le droit
              d'auteur. Toute reproduction, représentation, modification ou
              exploitation, totale ou partielle, sans autorisation préalable est
              interdite. Les données cartographiques proviennent d'OpenStreetMap et de
              ses contributeurs, sous licence ODbL.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">5. Responsabilité</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Les itinéraires proposés par Microbalade sont générés automatiquement à
              partir de données ouvertes et d'intelligence artificielle. Ils sont
              fournis à titre indicatif. Microbalade ne saurait être tenue responsable
              d'éventuelles erreurs d'itinéraire, d'inexactitudes dans les descriptions,
              ni des conditions rencontrées sur le terrain. Il appartient à chaque
              utilisateur d'évaluer la sécurité du parcours et de respecter le code de
              la route.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">6. Données personnelles</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Le traitement des données personnelles est détaillé dans notre{" "}
              <Link to="/confidentialite" className="text-primary hover:underline">
                politique de confidentialité
              </Link>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-xl font-bold">7. Droit applicable</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Les présentes mentions légales sont régies par le droit français. Tout
              litige relatif à l'utilisation du site sera soumis aux tribunaux français
              compétents.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LegalNotice;
