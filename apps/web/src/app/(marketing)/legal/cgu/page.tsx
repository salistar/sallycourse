import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '../legal-layout';

// Conditions Générales d'Utilisation — page statique (P66, i18n-ready : texte
// FR par défaut, structure prête pour traduction via next-intl si le contenu
// légal est un jour internationalisé).

export const metadata: Metadata = {
  title: 'Conditions Générales d’Utilisation — SallyCourse',
  description: 'Règles d’utilisation de la plateforme SallyCourse : compte, contenu généré par IA, obligations des parties.',
};

const UPDATED_AT = '7 juillet 2026';

export default function CguPage() {
  return (
    <LegalPage title="Conditions Générales d’Utilisation" updatedAt={UPDATED_AT} active="/legal/cgu">
      <LegalSection title="1. Objet">
        <p>
          Les présentes Conditions Générales d’Utilisation (« CGU ») régissent l’accès et
          l’utilisation de la plateforme SallyCourse (« le Service »), éditée pour permettre à
          ses utilisateurs (« vous », « l’Utilisateur ») de générer automatiquement des cours en
          ligne — plans de cours, vidéos, articles, travaux pratiques et quiz — à partir d’un
          titre et d’un niveau, puis de les publier sur des plateformes tierces (Udemy, YouTube,
          Teachable, et autres) ou sur le LMS interne du Service.
        </p>
        <p>
          L’utilisation du Service implique l’acceptation pleine et entière des présentes CGU.
        </p>
      </LegalSection>

      <LegalSection title="2. Compte utilisateur">
        <p>
          L’accès aux fonctionnalités de génération nécessite la création d’un compte (email et
          mot de passe, ou connexion via un fournisseur tiers). Vous êtes responsable de la
          confidentialité de vos identifiants et de toute activité réalisée depuis votre compte.
        </p>
        <p>
          Vous garantissez l’exactitude des informations fournies lors de l’inscription et vous
          engagez à les maintenir à jour.
        </p>
      </LegalSection>

      <LegalSection title="3. Contenu généré par intelligence artificielle">
        <p>
          Le Service repose sur des modèles d’intelligence artificielle (génération de texte,
          voix de synthèse, visuels) pour produire tout ou partie du contenu de vos cours. Vous
          reconnaissez et acceptez que :
        </p>
        <ul className="list-disc pl-5">
          <li>
            le contenu généré doit être relu et validé avant toute publication publique ;
          </li>
          <li>
            certaines plateformes de diffusion (notamment Udemy) exigent une mention explicite de
            transparence sur l’usage de l’IA dans le contenu publié ; le Service vous demande de
            confirmer cette mention avant tout déploiement concerné, et bloque la publication tant
            qu’elle n’est pas acceptée ;
          </li>
          <li>
            vous restez seul responsable du contenu final publié sous votre nom, y compris de sa
            conformité aux règles de la plateforme de diffusion choisie et à la réglementation
            applicable (droit d’auteur, désinformation, contenus interdits).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Plans et quotas">
        <p>
          Le Service propose plusieurs offres (Free, Pro, Business) avec des quotas de génération
          mensuels, des limites de déploiement multi-plateformes et des fonctionnalités distinctes
          (filigrane, accès API, multi-comptes). Le détail de chaque offre est disponible sur la
          page tarifs. Un dépassement de quota bloque la génération de nouveaux cours jusqu’au
          renouvellement de la période ou à la mise à niveau de l’offre.
        </p>
      </LegalSection>

      <LegalSection title="5. Propriété intellectuelle">
        <p>
          Vous conservez la propriété des cours que vous créez via le Service, sous réserve du
          respect des présentes CGU et des droits des tiers (sources utilisées, marques citées).
          Le Service, son code, son design et sa marque restent la propriété exclusive de son
          éditeur.
        </p>
      </LegalSection>

      <LegalSection title="6. Déploiement vers des plateformes tierces">
        <p>
          Le Service permet de connecter des comptes tiers (Udemy, YouTube, Teachable, Thinkific,
          Podia, Gumroad, Skillshare, Moodle) pour publier automatiquement vos cours. Vous restez
          seul responsable du respect des conditions d’utilisation de chacune de ces plateformes.
          Les identifiants de connexion sont chiffrés côté serveur et ne sont jamais stockés en
          clair.
        </p>
      </LegalSection>

      <LegalSection title="7. Résiliation">
        <p>
          Vous pouvez supprimer votre compte à tout moment depuis les réglages du Service. La
          suppression entraîne l’effacement définitif de vos cours, de vos contenus stockés et de
          vos données personnelles, conformément à notre politique de confidentialité.
        </p>
      </LegalSection>

      <LegalSection title="8. Limitation de responsabilité">
        <p>
          Le Service est fourni « en l’état ». L’éditeur ne garantit pas l’absence d’erreurs dans
          le contenu généré par IA, ni le succès de la publication sur une plateforme tierce
          (soumise à ses propres règles de revue). L’éditeur ne saurait être tenu responsable des
          pertes de revenus, de trafic ou de réputation liées à l’utilisation du contenu généré.
        </p>
      </LegalSection>

      <LegalSection title="9. Modification des CGU">
        <p>
          Les présentes CGU peuvent être mises à jour à tout moment. La date de dernière mise à
          jour figure en haut de cette page ; toute modification substantielle vous sera notifiée.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
