import { defineConfig, devices } from '@playwright/test';

/**
 * Configuration Playwright — régression visuelle du design system SALISTAR.
 *
 * Les captures de référence sont versionnées par projet et par plateforme
 * (les rendus de police diffèrent entre Windows/Linux/macOS) afin d'éviter
 * les faux positifs entre le poste local et la CI.
 *
 * Mise à jour volontaire des références :
 *   npx playwright test --update-snapshots
 */
export default defineConfig({
  testDir: './tests',
  // Seuls les specs visuels vivent ici ; les tests unitaires restent sous Vitest.
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  // Références rangées à côté du spec, séparées par projet + plateforme.
  snapshotPathTemplate:
    '{testDir}/visual/__screenshots__/{projectName}/{platform}/{arg}{ext}',

  expect: {
    toHaveScreenshot: {
      // Tolérance faible : on veut détecter tout glissement de tokens
      // (couleur, spacing, radius) sans être esclave de l'anti-aliasing.
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },

  use: {
    baseURL: 'http://127.0.0.1:3000',
    // Le styleguide SALISTAR est dark par défaut — on fige le schéma
    // pour que les media queries prefers-color-scheme soient déterministes.
    colorScheme: 'dark',
    // Réduit les animations pilotées par prefers-reduced-motion côté app.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Africa/Casablanca',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Garde-fou mobile : le styleguide doit rester lisible en 390px.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],

  // Démarre le serveur Next automatiquement (réutilisé en local si déjà lancé).
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
