import type { Metadata } from 'next';
import { LegalPage, LegalSection } from '../legal-layout';

// Conditions Générales de Vente — page statique (P66). Décrit la facturation
// des offres payantes (Pro/Business), sans mentionner de SDK de paiement
// précis (le projet règle CMI/Paddle/Lemon Squeezy en appels fetch directs).

export const metadata: Metadata = {
  title: 'Conditions Générales de Vente — SallyCourse',
  description: 'Modalités de facturation, de paiement et de remboursement des offres payantes SallyCourse.',
};

const UPDATED_AT = '7 juillet 2026';

export default function CgvPage() {
  return (
    <LegalPage title="Conditions Générales de Vente" updatedAt={UPDATED_AT} active="/legal/cgv">
      <LegalSection title="1. Champ d’application">
        <p>
          Les présentes Conditions Générales de Vente (« CGV ») s’appliquent à toute souscription
          à une offre payante de SallyCourse (Pro, Business), telles que décrites sur la page
          tarifs, et complètent les Conditions Générales d’Utilisation.
        </p>
      </LegalSection>

      <LegalSection title="2. Offres et tarifs">
        <p>
          Les offres, leurs quotas de génération mensuels et leurs tarifs sont affichés sur la
          page tarifs au moment de la souscription. Les prix sont indiqués toutes taxes comprises
          lorsque applicable. L’éditeur se réserve le droit de modifier ses tarifs ; toute
          modification s’applique aux périodes de facturation suivant sa publication, jamais
          rétroactivement.
        </p>
      </LegalSection>

      <LegalSection title="3. Paiement">
        <p>
          Le paiement s’effectue par carte bancaire ou tout autre moyen proposé lors de la
          souscription, via un prestataire de paiement tiers (selon la zone géographique :
          solutions locales pour le Maroc, solutions internationales pour l’Europe). SallyCourse
          ne stocke jamais vos coordonnées bancaires complètes ; elles sont traitées directement
          par le prestataire de paiement.
        </p>
        <p>
          L’abonnement est facturé par avance, pour une durée d’un mois, avec renouvellement
          automatique tacite jusqu’à résiliation.
        </p>
      </LegalSection>

      <LegalSection title="4. Durée et résiliation">
        <p>
          L’abonnement peut être résilié à tout moment depuis les réglages du compte. La
          résiliation prend effet à la fin de la période déjà payée : aucun remboursement au
          prorata n’est effectué pour la période en cours, sauf disposition légale contraire
          applicable dans votre juridiction.
        </p>
      </LegalSection>

      <LegalSection title="5. Défaut de paiement">
        <p>
          En cas d’échec de paiement au renouvellement, l’accès aux fonctionnalités de l’offre
          payante est suspendu et le compte repasse automatiquement sur les quotas de l’offre
          gratuite, sans perte des cours déjà créés.
        </p>
      </LegalSection>

      <LegalSection title="6. Droit de rétractation">
        <p>
          Conformément à la réglementation applicable aux contenus numériques fournis
          immédiatement après souscription, le droit de rétractation peut être exclu dès lors que
          vous avez expressément consenti à l’exécution immédiate du service et renoncé à votre
          droit de rétractation. Pour toute question, contactez le support avant de souscrire.
        </p>
      </LegalSection>

      <LegalSection title="7. Facturation et justificatifs">
        <p>
          Une facture est mise à disposition dans votre espace compte après chaque paiement
          réussi. Elle mentionne l’offre souscrite, la période couverte et le montant payé.
        </p>
      </LegalSection>

      <LegalSection title="8. Litiges">
        <p>
          En cas de désaccord sur une facturation, contactez le support en premier lieu. À défaut
          de résolution amiable, les présentes CGV sont soumises au droit applicable au lieu
          d’établissement de l’éditeur.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
