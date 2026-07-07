import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright — E2E fonctionnel (Prompt 67), séparée de
 * playwright.config.ts (régression visuelle D12, captures d'écran figées).
 *
 * Contrairement au config visuel, celui-ci NE démarre PAS le serveur : le
 * scénario register → create → outline-review → approve a besoin de la pile
 * complète (Next + worker + Mongo + Redis, `pnpm up` puis `pnpm dev`/`pnpm
 * --filter worker dev`). On suppose donc un serveur déjà up sur E2E_BASE_URL
 * (défaut http://localhost:3000) ; chaque spec vérifie lui-même l'accessibilité
 * de l'app (cf. tests/e2e/fixtures.ts) et se SKIPPE proprement si elle ne
 * répond pas, plutôt que de faire échouer `pnpm test:e2e` en local sans stack.
 *
 * Lancer :
 *   pnpm up                                    # mongo/redis/minio (+ web/worker si profil full)
 *   MOCK_PROVIDERS=true pnpm --filter @sallycourse/worker dev   # génération sans coût réel
 *   pnpm --filter @sallycourse/web dev
 *   pnpm --filter @sallycourse/web test:e2e
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // scénarios stateful (comptes/quota) : exécution séquentielle plus sûre
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
  },

  projects: [
    {
      name: 'e2e-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  // Pas de webServer : voir note ci-dessus (stack complète requise, gérée hors Playwright).
});
