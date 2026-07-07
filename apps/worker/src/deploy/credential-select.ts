// Sélection du compte plateforme à utiliser pour un déploiement (Prompt 49).
// Logique PURE (aucun accès base) : à partir de la liste des comptes connectés
// d'un utilisateur pour une plateforme et d'un credentialId éventuel, décide
// quel compte retenir. Testable hors-ligne (le processor fait l'I/O Mongo).

/** Forme minimale d'un compte plateforme pour la sélection. */
export interface CredentialCandidate {
  /** Identifiant du PlatformCredential (string de l'ObjectId). */
  id: string;
  platform: string;
  accountLabel: string;
}

/**
 * Choisit le compte à utiliser parmi `candidates` :
 *  - si `credentialId` est fourni, retourne le compte correspondant (ou undefined
 *    s'il n'existe pas / n'appartient pas à la liste — jamais de repli silencieux
 *    sur un autre compte, pour ne pas publier avec le mauvais compte) ;
 *  - sinon, premier compte de la liste (l'ordre d'appel décide la priorité,
 *    typiquement le plus récemment mis à jour), ou undefined si aucun.
 */
export function selectCredential<T extends CredentialCandidate>(
  candidates: T[],
  credentialId?: string,
): T | undefined {
  if (credentialId) {
    return candidates.find((c) => c.id === credentialId);
  }
  return candidates[0];
}
