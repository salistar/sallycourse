// Mode agence (Prompt 150) : logique PURE (aucune I/O) pour deux besoins
// séparés — l'ISOLATION des credentials de déploiement (un cours en mode
// agence utilise TOUJOURS les comptes du client, jamais ceux de l'agence) et
// l'AGRÉGATION des coûts par client pour la facturation séparée. L'appelant
// (route API / worker) charge les documents Mongo puis passe des DTOs simples
// à ces fonctions — testable entièrement hors-ligne (vitest).

/** Un client d'agence minimal, DTO agnostique Mongoose. */
export interface AgencyClientLike {
  id: string;
  agencyUserId: string;
  clientName: string;
  clientEmail: string;
  /** Ids des PlatformCredential appartenant à CE client (jamais à l'agence). */
  platformCredentials: string[];
}

/** Un cours minimal pour la résolution de contexte agence. */
export interface AgencyCourseLike {
  userId: string;
  agencyClientId?: string | null;
}

export interface AgencyContextResult {
  /** true si ce cours est généré/déployé au nom d'un client d'agence. */
  isAgencyContext: boolean;
  /**
   * Ids des PlatformCredential à utiliser pour le déploiement — ceux du
   * client si contexte agence, tableau vide sinon (l'appelant retombe alors
   * sur son comportement standard : credentials du userId propriétaire).
   */
  allowedCredentialIds: string[];
  /** Motif si le contexte agence est demandé mais invalide (client introuvable / n'appartient pas à l'agence). */
  reason?: string;
}

/**
 * Résout le contexte agence d'un cours : si `agencyClientId` est renseigné,
 * retourne la liste des credentials AUTORISÉS (ceux du client, uniquement) —
 * pour que le déploiement ne puisse JAMAIS retomber silencieusement sur un
 * compte de l'agence. Si le client n'appartient pas à l'agence propriétaire du
 * cours (agencyUserId ≠ course.userId), le contexte est invalide : aucun
 * credential n'est autorisé (fail closed, jamais un mélange agence/client).
 */
export function resolveAgencyDeployCredentials(
  course: AgencyCourseLike,
  client: AgencyClientLike | null,
): AgencyContextResult {
  if (!course.agencyClientId) {
    return { isAgencyContext: false, allowedCredentialIds: [] };
  }
  if (!client) {
    return {
      isAgencyContext: true,
      allowedCredentialIds: [],
      reason: 'Client d’agence introuvable pour ce cours.',
    };
  }
  if (client.agencyUserId !== course.userId) {
    return {
      isAgencyContext: true,
      allowedCredentialIds: [],
      reason: 'Ce client n’appartient pas à l’agence propriétaire du cours.',
    };
  }
  return { isAgencyContext: true, allowedCredentialIds: [...client.platformCredentials] };
}

/**
 * Vérifie qu'un credentialId précis est autorisé dans ce contexte. Utilisée
 * juste avant le déchiffrement/usage réel du secret — dernière barrière avant
 * qu'un déploiement agence ne touche un compte qui n'est pas celui du client.
 */
export function isCredentialAllowedForAgencyCourse(
  course: AgencyCourseLike,
  client: AgencyClientLike | null,
  credentialId: string,
): boolean {
  const ctx = resolveAgencyDeployCredentials(course, client);
  if (!ctx.isAgencyContext) return true; // pas de contexte agence : règle standard inchangée.
  return ctx.allowedCredentialIds.includes(credentialId);
}

/* ------------------------------------------------------------------ */
/* Facturation par client (agrégation des coûts)                       */
/* ------------------------------------------------------------------ */

/** Ligne de coût minimale pour l'agrégation par client (déjà projetée depuis CostRecord + Course). */
export interface AgencyCostRow {
  agencyClientId: string;
  courseId: string;
  estimatedUsd: number;
}

/** Rapport facturable agrégé pour un client d'agence. */
export interface AgencyClientBillingReport {
  agencyClientId: string;
  clientName: string;
  clientEmail: string;
  /** Nombre de cours distincts ayant généré du coût pour ce client. */
  courseCount: number;
  /** Coût total agrégé (USD), arrondi à 4 décimales. */
  totalUsd: number;
  /** Détail par cours (utile pour le justificatif de facture). */
  byCourse: Array<{ courseId: string; totalUsd: number }>;
}

/**
 * Agrège des lignes de coût par client d'agence — un rapport facturable
 * séparé par client, jamais mélangé avec les coûts propres de l'agence (les
 * lignes sans agencyClientId ne doivent simplement pas être passées ici).
 * Fonction PURE : l'appelant filtre déjà les CostRecord par agencyClientId.
 */
export function aggregateAgencyBilling(
  rows: readonly AgencyCostRow[],
  clients: readonly Pick<AgencyClientLike, 'id' | 'clientName' | 'clientEmail'>[],
): AgencyClientBillingReport[] {
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const byClient = new Map<string, Map<string, number>>();

  for (const row of rows) {
    let courseMap = byClient.get(row.agencyClientId);
    if (!courseMap) {
      courseMap = new Map();
      byClient.set(row.agencyClientId, courseMap);
    }
    courseMap.set(row.courseId, (courseMap.get(row.courseId) ?? 0) + row.estimatedUsd);
  }

  const reports: AgencyClientBillingReport[] = [];
  for (const [agencyClientId, courseMap] of byClient) {
    const client = clientById.get(agencyClientId);
    const byCourse = [...courseMap.entries()]
      .map(([courseId, totalUsd]) => ({ courseId, totalUsd: round(totalUsd) }))
      .sort((a, b) => b.totalUsd - a.totalUsd);
    const totalUsd = round(byCourse.reduce((acc, c) => acc + c.totalUsd, 0));
    reports.push({
      agencyClientId,
      clientName: client?.clientName ?? 'Client inconnu',
      clientEmail: client?.clientEmail ?? '',
      courseCount: byCourse.length,
      totalUsd,
      byCourse,
    });
  }

  // Coût total décroissant : les clients les plus consommateurs d'abord.
  return reports.sort((a, b) => b.totalUsd - a.totalUsd);
}

/** Arrondi USD à 4 décimales (cohérent avec cost-stats.ts côté web). */
function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
