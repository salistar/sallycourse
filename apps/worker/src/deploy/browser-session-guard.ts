// Prompt 126 — Garde de durée de vie des sessions navigateur des adapters de
// déploiement (Udemy/Kajabi/Podia/Skillshare…). Complète les timeouts PAR
// ACTION déjà posés par Playwright (page.fill/click/goto ont un timeout
// individuel) par un timeout GLOBAL sur la session entière : si un adapter
// reste bloqué anormalement longtemps (page qui ne répond jamais, boucle de
// polling infinie, process zombifié…), le contexte — et donc le navigateur
// sous-jacent — est fermé de force, journalisé clairement, plutôt que de
// laisser un chromium headless tourner indéfiniment sur le worker.
//
// Analogue à killTpContainersOlderThan (media/tp-environments.ts) mais pour un
// browserContext Playwright unique surveillé en mémoire (pas de docker ici).

import type { BrowserContext } from 'playwright';
import { logger } from '../queues/index.js';

/** Délai par défaut avant fermeture forcée d'une session adapter : 10 minutes. */
export const DEFAULT_SESSION_TIMEOUT_MS = 10 * 60 * 1_000;

/** Poignée de garde retournée par guardBrowserSession — à libérer via `dispose()`. */
export interface BrowserSessionGuard {
  /** Annule le timeout programmé (à appeler dès que la session se termine normalement). */
  dispose(): void;
}

/**
 * Arme un timeout qui ferme de force `context` (et journalise) si la session
 * dépasse `timeoutMs`. Retourne une poignée à `dispose()` en fin de flow normal
 * (dans un `finally`) pour éviter toute fermeture tardive intempestive.
 *
 * `label` identifie la plateforme/l'étape dans les logs (ex. "udemy.deploy").
 * Ne jette jamais : la fermeture forcée est best-effort (context.close peut
 * déjà avoir été appelé par ailleurs).
 */
export function guardBrowserSession(
  context: BrowserContext,
  label: string,
  timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
): BrowserSessionGuard {
  const timer = setTimeout(() => {
    logger.warn(
      { label, timeoutMs },
      `session navigateur « ${label} » dépasse ${timeoutMs} ms — fermeture forcée du contexte`,
    );
    void context.close().catch((err) => {
      logger.warn({ label, err }, `fermeture forcée du contexte « ${label} » a échoué (déjà fermé ?)`);
    });
  }, timeoutMs);
  // N'empêche pas le process de se terminer si tout le reste est fini.
  timer.unref?.();

  return {
    dispose(): void {
      clearTimeout(timer);
    },
  };
}
