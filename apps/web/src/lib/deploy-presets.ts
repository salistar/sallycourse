import { isKnownPlatform } from '@/lib/deploy-catalog';
import type { DeploymentMode } from '@sallycourse/db';

/**
 * Marketplace de préconfiguration de déploiement (P109) — logique PURE
 * (aucun accès DB/queue ici) de construction des jobs à enqueuer à partir
 * d'un preset. Séparée de la route pour rester testable sans mock lourd.
 */

/** Entrée de plateforme d'un preset, telle que stockée en base. */
export interface PresetPlatformEntry {
  platform: string;
  mode: DeploymentMode;
  accountLabel?: string;
}

/** Compte connu de l'utilisateur courant (pour résoudre accountLabel → credentialId). */
export interface ResolvableCredential {
  id: string;
  platform: string;
  accountLabel: string;
}

/** Job à enqueuer pour une plateforme du preset (forme minimale, indépendante de BullMQ). */
export interface PresetDeployJob {
  platform: string;
  mode: DeploymentMode;
  credentialId?: string;
}

export interface BuildPresetJobsResult {
  jobs: PresetDeployJob[];
  /** Plateformes du preset ignorées (adapter inconnu) — jamais silencieux côté API. */
  skipped: { platform: string; reason: 'unknown_platform' }[];
}

/**
 * Construit la liste des jobs de déploiement à enqueuer pour un preset donné,
 * en résolvant chaque accountLabel vers le credentialId de l'utilisateur
 * COURANT (jamais celui du créateur du preset — un preset partagé ne
 * transporte qu'un libellé, pas un identifiant de compte d'autrui).
 * Une plateforme sans adapter connu est écartée (signalée dans `skipped`),
 * jamais silencieusement ignorée.
 */
export function buildPresetDeployJobs(
  platforms: readonly PresetPlatformEntry[],
  userCredentials: readonly ResolvableCredential[],
): BuildPresetJobsResult {
  const jobs: PresetDeployJob[] = [];
  const skipped: { platform: string; reason: 'unknown_platform' }[] = [];

  for (const entry of platforms) {
    if (!isKnownPlatform(entry.platform)) {
      skipped.push({ platform: entry.platform, reason: 'unknown_platform' });
      continue;
    }

    let credentialId: string | undefined;
    if (entry.accountLabel) {
      credentialId = userCredentials.find(
        (c) => c.platform === entry.platform && c.accountLabel === entry.accountLabel,
      )?.id;
    }

    jobs.push({
      platform: entry.platform,
      mode: entry.mode,
      ...(credentialId ? { credentialId } : {}),
    });
  }

  return { jobs, skipped };
}
