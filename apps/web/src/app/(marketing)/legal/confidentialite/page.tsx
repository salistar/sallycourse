import Link from 'next/link';
import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '../legal-layout';

// Politique de confidentialité (RGPD) — page statique (P66). Décrit les
// données collectées, leur usage, les droits de l'utilisateur et renvoie vers
// les routes concrètes de self-service (export / suppression) du compte.

export const metadata: Metadata = {
  title: 'Politique de confidentialité — SallyCourse',
  description: 'Comment SallyCourse collecte, utilise et protège vos données personnelles, et comment exercer vos droits RGPD.',
};

const UPDATED_AT = '7 juillet 2026';

export default function ConfidentialitePage() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      updatedAt={UPDATED_AT}
      active="/legal/confidentialite"
    >
      <LegalSection title="1. Responsable de traitement">
        <p>
          SallyCourse traite vos données personnelles en qualité de responsable de traitement,
          dans le cadre de la fourniture du Service. Cette politique décrit les données
          collectées, leur finalité, leur durée de conservation et vos droits.
        </p>
      </LegalSection>

      <LegalSection title="2. Données collectées">
        <ul className="list-disc pl-5">
          <li>
            <span className="font-medium text-foreground">Compte</span> : email, nom, mot de
            passe (haché, jamais en clair), langue préférée, plan souscrit.
          </li>
          <li>
            <span className="font-medium text-foreground">Contenu</span> : titres, plans de
            cours, scripts, articles, vidéos, quiz et autres contenus générés ou importés.
          </li>
          <li>
            <span className="font-medium text-foreground">Connexions plateformes</span> :
            identifiants de connexion à des plateformes tierces (Udemy, YouTube…), chiffrés au
            repos et jamais accessibles en clair, même par les équipes techniques.
          </li>
          <li>
            <span className="font-medium text-foreground">Facturation</span> : historique
            d’abonnement et références de paiement (jamais les coordonnées bancaires complètes,
            gérées par le prestataire de paiement).
          </li>
          <li>
            <span className="font-medium text-foreground">Usage</span> : journaux techniques de
            génération et de déploiement, nécessaires au fonctionnement et au support.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Finalités du traitement">
        <p>
          Vos données sont utilisées pour : fournir le Service (génération et publication de
          cours), gérer votre compte et votre abonnement, assurer le support, améliorer la
          qualité du produit et respecter nos obligations légales.
        </p>
      </LegalSection>

      <LegalSection title="4. Base légale">
        <p>
          Le traitement repose sur l’exécution du contrat qui vous lie à SallyCourse (fourniture
          du Service), sur votre consentement lorsque requis (ex. connexion à un compte tiers), et
          sur l’intérêt légitime de l’éditeur pour l’amélioration du produit.
        </p>
      </LegalSection>

      <LegalSection title="5. Durée de conservation">
        <p>
          Vos données sont conservées tant que votre compte est actif. En cas de suppression de
          compte, l’ensemble de vos données personnelles, cours et contenus stockés sont
          définitivement effacés, à l’exception des données dont la conservation est requise par
          la loi (ex. facturation), conservées pour la durée légale applicable puis supprimées.
        </p>
      </LegalSection>

      <LegalSection title="6. Vos droits">
        <p>
          Conformément au RGPD, vous disposez d’un droit d’accès, de rectification, d’effacement,
          de limitation et de portabilité de vos données. Deux actions sont disponibles en
          libre-service depuis votre compte :
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-medium text-foreground">Exporter vos données</span> :
            téléchargez une archive complète (profil, cours, plateformes connectées, historique)
            depuis <Link href="/dashboard/settings/account" className="text-primary hover:underline">Réglages → Compte</Link>.
          </li>
          <li>
            <span className="font-medium text-foreground">Supprimer votre compte</span> :
            suppression définitive et immédiate de votre compte, de vos cours et de tous les
            contenus associés, depuis la même page.
          </li>
        </ul>
        <p>
          Pour toute autre demande relative à vos données, contactez le support.
        </p>
      </LegalSection>

      <LegalSection title="7. Partage des données">
        <p>
          Vos données ne sont jamais vendues. Elles peuvent être transmises à des sous-traitants
          strictement nécessaires au fonctionnement du Service (hébergement, stockage objet,
          envoi d’emails transactionnels, prestataire de paiement), liés par des engagements de
          confidentialité, ainsi qu’aux plateformes tierces que vous connectez explicitement pour
          publier vos cours.
        </p>
      </LegalSection>

      <LegalSection title="8. Sécurité">
        <p>
          Les mots de passe sont hachés, les identifiants de connexion aux plateformes tierces
          sont chiffrés (AES-256-GCM) au repos, et les accès à la base de données sont restreints
          aux services applicatifs internes.
        </p>
      </LegalSection>

      <LegalSection title="9. Contact">
        <p>
          Pour exercer vos droits ou pour toute question relative à cette politique, contactez le
          support depuis votre espace compte.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
