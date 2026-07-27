// Anti-partage de compte — politique de sessions/appareils simultanés (P206).
// Logique PURE (aucune I/O ni node:crypto) : à partir d'une liste de sessions
// de visionnage horodatées, on détermine les appareils ACTIFS dans une fenêtre
// glissante et si l'étudiant dépasse le maximum autorisé. L'upsert Mongo et le
// hachage d'empreinte (node:crypto) vivent côté route (I/O). Rester pur ici
// garantit la testabilité sans base ET évite de tirer node:crypto dans un
// sous-module importable côté web.
//
// Décision produit (P206) : max 2 appareils simultanés par étudiant sur une
// fenêtre glissante. Au-delà → alerte à l'étudiant + signalement à l'auteur/
// admin, mais JAMAIS de blocage automatique du compte (faux positifs trop
// coûteux : un étudiant légitime change de réseau, d'onglet, de terminal).

/** Nombre maximal d'appareils actifs simultanés tolérés par étudiant. */
export const MAX_CONCURRENT_DEVICES = 2;

/**
 * Fenêtre d'activité : un appareil est « actif » si sa dernière lecture date de
 * moins de FENÊTRE. 15 min couvre une session de visionnage continue (lectures
 * rafraîchies à chaque leçon/heartbeat) sans compter indéfiniment un appareil
 * fermé.
 */
export const ACTIVE_WINDOW_MS = 15 * 60 * 1_000;

/**
 * Anti-spam d'alerte : on ne re-signale un dépassement qu'une fois par heure
 * (l'étudiant peut enchaîner les lectures ; inutile d'inonder l'auteur).
 */
export const ALERT_COOLDOWN_MS = 60 * 60 * 1_000;

/** Une session de visionnage minimale (dénormalisée depuis ViewingSession). */
export interface ViewingSessionLike {
  /** Identifiant stable et opaque de l'appareil (empreinte hachée). */
  deviceId: string;
  /** Dernière activité observée (epoch ms). */
  lastSeenAt: number;
}

export interface ConcurrencyEvaluation {
  /** Identifiants des appareils actifs dans la fenêtre (dédupliqués). */
  activeDeviceIds: string[];
  /** Nombre d'appareils actifs distincts. */
  activeCount: number;
  /** Vrai si activeCount > maxDevices. */
  overLimit: boolean;
}

export interface EvaluateConcurrencyOptions {
  maxDevices?: number;
  windowMs?: number;
  now?: number;
}

/**
 * Évalue les appareils simultanés d'un étudiant : dédoublonne par deviceId,
 * ne retient que ceux vus dans la fenêtre glissante, et signale le dépassement.
 * Pur et déterministe (aucune dépendance temporelle implicite : `now` injecté).
 */
export function evaluateConcurrentSessions(
  sessions: readonly ViewingSessionLike[],
  options: EvaluateConcurrencyOptions = {},
): ConcurrencyEvaluation {
  const maxDevices = options.maxDevices ?? MAX_CONCURRENT_DEVICES;
  const windowMs = options.windowMs ?? ACTIVE_WINDOW_MS;
  const now = options.now ?? Date.now();
  const cutoff = now - windowMs;

  const active = new Set<string>();
  for (const s of sessions) {
    if (s.deviceId && s.lastSeenAt >= cutoff) active.add(s.deviceId);
  }
  const activeDeviceIds = [...active];
  return {
    activeDeviceIds,
    activeCount: activeDeviceIds.length,
    overLimit: activeDeviceIds.length > maxDevices,
  };
}

/**
 * Décide s'il faut (re)émettre une alerte de partage de compte : uniquement en
 * dépassement ET si la dernière alerte est plus ancienne que le cooldown (ou
 * absente). Évite le spam tout en re-signalant un abus persistant.
 */
export function shouldAlertAccountSharing(
  overLimit: boolean,
  lastAlertedAt: number | null | undefined,
  options: { cooldownMs?: number; now?: number } = {},
): boolean {
  if (!overLimit) return false;
  const cooldownMs = options.cooldownMs ?? ALERT_COOLDOWN_MS;
  const now = options.now ?? Date.now();
  if (lastAlertedAt === null || lastAlertedAt === undefined) return true;
  return now - lastAlertedAt >= cooldownMs;
}
