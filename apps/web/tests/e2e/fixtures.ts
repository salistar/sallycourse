import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Helpers communs des specs E2E (Prompt 67). Le scénario complet register →
 * create → outline-review → approve a besoin de la stack réelle (Next +
 * worker + Mongo + Redis) — CE N'EST PAS toujours dispo (poste dev sans
 * `pnpm up`, CI minimal). Chaque spec appelle `requireLiveApp` en tout
 * premier et se SKIPPE proprement si l'app ne répond pas, au lieu de faire
 * échouer `pnpm test:e2e`.
 */

/** Email jetable unique par run — évite les collisions entre exécutions. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.sallycourse.test`;
}

/**
 * Vérifie que l'app cible répond (page de login chargeable). Retourne false
 * si injoignable (serveur non démarré) — l'appelant doit alors `test.skip()`.
 */
export async function isAppReachable(request: APIRequestContext, baseURL: string): Promise<boolean> {
  try {
    const response = await request.get(`${baseURL}/login`, { timeout: 5_000 });
    return response.ok();
  } catch {
    return false;
  }
}

/**
 * Vérifie que le worker de génération tourne réellement (heartbeat via
 * /api/health). Sans lui, un cours reste bloqué en 'generating' et jamais en
 * 'outline-review' — les specs qui en dépendent skippent alors CETTE portion
 * du scénario (le reste du parcours UI reste vérifié).
 */
export async function isWorkerAlive(request: APIRequestContext, baseURL: string): Promise<boolean> {
  try {
    const response = await request.get(`${baseURL}/api/health`, { timeout: 5_000 });
    const body = (await response.json().catch(() => null)) as { checks?: { worker?: { ok?: boolean } } } | null;
    return body?.checks?.worker?.ok === true;
  } catch {
    return false;
  }
}

/** Inscrit un nouvel utilisateur via le formulaire UI et attend l'entrée dashboard. */
export async function registerViaUi(
  page: Page,
  opts: { name: string; email: string; password: string },
): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Nom complet').fill(opts.name);
  await page.getByLabel('Adresse email').fill(opts.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(opts.password);
  await page.getByLabel('Confirmer le mot de passe').fill(opts.password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL(/\/dashboard(\/|$)/, { timeout: 20_000 });
}
