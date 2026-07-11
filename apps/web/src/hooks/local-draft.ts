/**
 * Brouillon local (P131) — filet de sécurité contre la perte de contenu
 * quand la sauvegarde serveur échoue (réseau coupé, session expirée…) :
 * on écrit une copie de la valeur éditée dans localStorage, et on propose de
 * la restaurer au rechargement de la page si elle diffère de ce que le
 * serveur a effectivement persisté.
 *
 * Fonctions pures (pas de dépendance React) : testables sans jsdom via un
 * mock minimal de l'API Storage.
 */

const PREFIX = 'sallycourse:draft:';

export interface LocalDraft<T> {
  value: T;
  savedAt: string; // ISO — horodatage de l'écriture locale.
}

function keyFor(scope: string): string {
  return `${PREFIX}${scope}`;
}

/** Écrit le brouillon local. Silencieux si localStorage est indisponible (quota, SSR). */
export function writeLocalDraft<T>(scope: string, value: T, storage: Storage = safeStorage()): void {
  try {
    const draft: LocalDraft<T> = { value, savedAt: new Date().toISOString() };
    storage.setItem(keyFor(scope), JSON.stringify(draft));
  } catch {
    // Quota dépassé ou storage indisponible : le brouillon local est un
    // filet best-effort, on n'interrompt jamais l'édition pour ça.
  }
}

/** Lit le brouillon local s'il existe, sinon null. */
export function readLocalDraft<T>(scope: string, storage: Storage = safeStorage()): LocalDraft<T> | null {
  try {
    const raw = storage.getItem(keyFor(scope));
    if (!raw) return null;
    return JSON.parse(raw) as LocalDraft<T>;
  } catch {
    return null;
  }
}

/** Efface le brouillon local (après une sauvegarde serveur réussie). */
export function clearLocalDraft(scope: string, storage: Storage = safeStorage()): void {
  try {
    storage.removeItem(keyFor(scope));
  } catch {
    // no-op
  }
}

/**
 * Décide si un brouillon local doit être proposé à la restauration : il doit
 * exister et différer (par valeur sérialisée) du contenu serveur actuel.
 */
export function shouldOfferRecovery<T>(draft: LocalDraft<T> | null, serverValue: T): boolean {
  if (!draft) return false;
  return JSON.stringify(draft.value) !== JSON.stringify(serverValue);
}

/** Storage no-op pour environnements sans window (SSR, tests sans mock explicite). */
function safeStorage(): Storage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return {
    length: 0,
    clear() {},
    getItem() {
      return null;
    },
    key() {
      return null;
    },
    removeItem() {},
    setItem() {},
  };
}
