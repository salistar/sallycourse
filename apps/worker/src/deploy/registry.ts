// Registre des adapters de déploiement, indexé par nom de plateforme.
// Les adapters concrets (Prompt 112) s'enregistrent via registerAdapter ;
// le processor résout l'adapter via getAdapter(platform).

import type { DeploymentAdapter } from './types.js';

const registry = new Map<string, DeploymentAdapter>();

/**
 * Enregistre un adapter pour sa plateforme. Idempotent par écrasement :
 * réenregistrer la même plateforme remplace l'adapter (pratique en test).
 */
export function registerAdapter(adapter: DeploymentAdapter): void {
  registry.set(adapter.platform, adapter);
}

/** Résout l'adapter d'une plateforme ; jette si aucun n'est enregistré. */
export function getAdapter(platform: string): DeploymentAdapter {
  const adapter = registry.get(platform);
  if (!adapter) {
    const known = [...registry.keys()].join(', ') || '(aucune)';
    throw new Error(
      `Aucun adapter de déploiement pour la plateforme « ${platform} » (connues : ${known}).`,
    );
  }
  return adapter;
}

/** Indique si une plateforme dispose d'un adapter enregistré. */
export function hasAdapter(platform: string): boolean {
  return registry.has(platform);
}

/** Liste les plateformes enregistrées (diagnostic/tests). */
export function listAdapters(): string[] {
  return [...registry.keys()];
}

/** Vide le registre (isolation des tests). */
export function clearAdapters(): void {
  registry.clear();
}
