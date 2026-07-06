import { test, expect, type Page } from '@playwright/test';

/**
 * Régression visuelle du styleguide SALISTAR.
 *
 * Chaque page de référence du design system est capturée en pleine hauteur
 * et comparée pixel à pixel à sa capture de référence. Toute dérive
 * (token modifié, composant cassé, régression RTL) fait échouer le test.
 *
 * Les références se mettent à jour uniquement de façon délibérée :
 *   npx playwright test --update-snapshots
 */

/** Écrans du design system couverts par la régression visuelle. */
const ECRANS = [
  { chemin: '/design', capture: 'styleguide.png' },
  { chemin: '/design/components', capture: 'components.png' },
  { chemin: '/design/motion', capture: 'motion.png' },
] as const;

/**
 * Stabilise la page avant capture : polices chargées, animations gelées.
 * Les animations infinies (shimmer, ping, gradient-pan, indéterminé) ne sont
 * pas couvertes par `animations: 'disabled'` tant qu'elles tournent en boucle —
 * on les fige donc via une feuille de style injectée.
 */
async function stabiliserPage(page: Page): Promise<void> {
  // Attendre le chargement complet des webfonts (Fraunces/Figtree/IBM Plex
  // Sans Arabic) pour éviter les diffs de fallback système.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  // Geler transitions et animations (y compris les boucles infinies).
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-play-state: paused !important;
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
    `,
  });

  // Laisser le layout se stabiliser après le gel (framer-motion, images SVG).
  await page.waitForLoadState('networkidle');
}

test.describe('Styleguide SALISTAR — régression visuelle', () => {
  for (const ecran of ECRANS) {
    test(`capture stable de ${ecran.chemin}`, async ({ page }) => {
      await page.goto(ecran.chemin, { waitUntil: 'networkidle' });

      // Invariant du design system : dark mode par défaut sur <html>.
      await expect(page.locator('html')).toHaveClass(/dark/);

      await stabiliserPage(page);

      await expect(page).toHaveScreenshot(ecran.capture, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
    });
  }

  test('section RTL du styleguide composants rendue en arabe', async ({ page }) => {
    await page.goto('/design/components', { waitUntil: 'networkidle' });
    await stabiliserPage(page);

    // La vitrine RTL doit exister et déclarer dir/lang corrects —
    // garde-fou contre la suppression accidentelle de la couverture RTL.
    const sectionRtl = page.locator('[dir="rtl"]').first();
    await expect(sectionRtl).toBeVisible();
    await expect(sectionRtl).toHaveAttribute('lang', 'ar');

    await expect(sectionRtl).toHaveScreenshot('components-rtl.png', {
      animations: 'disabled',
      caret: 'hide',
    });
  });
});
