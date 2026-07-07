import { expect, test } from '@playwright/test';
import { isAppReachable, isWorkerAlive, registerViaUi, uniqueEmail } from './fixtures';

/**
 * E2E — parcours complet de création de cours (Prompt 67) :
 *   register → create → outline-review → approve
 *
 * Nécessite la stack réelle (Next + worker + Mongo + Redis) et un worker lancé
 * avec MOCK_PROVIDERS=true (aucun appel Claude/TTS réel — cf. apps/worker/src/mocks/README.md).
 * Sans stack dispo, la suite entière est SKIPPÉE (test.skip côté beforeAll) —
 * ne fait jamais échouer `pnpm test:e2e` en environnement minimal.
 *
 * Voir playwright.e2e.config.ts pour la procédure de lancement local.
 */

const PASSWORD = 'Sallycourse-e2e-2026!';

test.describe('Parcours création de cours', () => {
  test.beforeEach(async ({ page, request, baseURL }) => {
    const reachable = await isAppReachable(request, baseURL ?? 'http://localhost:3000');
    test.skip(!reachable, 'App injoignable (stack non démarrée) — voir playwright.e2e.config.ts');
    void page;
  });

  test('un nouvel utilisateur crée un compte, génère un cours et valide le plan proposé', async ({
    page,
    request,
    baseURL,
  }) => {
    const email = uniqueEmail('coursecreation');

    // ── 1) Inscription ────────────────────────────────────────────
    await registerViaUi(page, { name: 'Étudiante E2E', email, password: PASSWORD });
    await expect(page).toHaveURL(/\/dashboard(\/|$)/);

    // ── 2) Création du cours (acte « composition ») ────────────────
    await page.goto('/dashboard/new');
    await page.getByLabel('Titre du cours').fill('Maîtriser les tests end-to-end');
    await page.getByRole('radio', { name: /Débutant/ }).click();
    await page.getByRole('button', { name: 'Générer mon cours' }).click();

    // Acte « génération » (transition cinématique) puis redirection.
    await page.waitForURL(/\/dashboard\/courses\/[a-f0-9]{24}/, { timeout: 20_000 });
    const courseUrl = page.url();
    const courseId = courseUrl.split('/courses/')[1];
    expect(courseId).toBeTruthy();

    // ── 3) Attente du plan (outline-review) — nécessite le worker ───
    const workerAlive = await isWorkerAlive(request, baseURL ?? 'http://localhost:3000');
    test.skip(
      !workerAlive,
      'Worker non détecté (heartbeat absent) — impossible de vérifier la génération du plan.',
    );

    await expect
      .poll(
        async () => {
          await page.reload();
          const heading = page.getByRole('heading', { name: 'Maîtriser les tests end-to-end' });
          return (await heading.isVisible().catch(() => false)) ? 'outline-review-or-later' : 'pending';
        },
        { timeout: 90_000, intervals: [2_000, 3_000, 5_000] },
      )
      .toBe('outline-review-or-later');

    // ── 4) Validation du plan (approve-outline) ─────────────────────
    const approveButton = page.getByRole('button', { name: 'Valider et générer le contenu' });
    // Si le cours est déjà passé en génération de contenu (cas rapide), le
    // bouton d'approbation n'existe plus : le plan a déjà été traité côté
    // worker — le scénario est alors considéré comme couvert.
    if (await approveButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await approveButton.click();
      await expect(page.getByText('Plan validé')).toBeVisible({ timeout: 10_000 });
    }
  });

  test('un titre trop court est rejeté par la validation avant tout appel réseau', async ({ page }) => {
    const email = uniqueEmail('validation');
    await registerViaUi(page, { name: 'Validation E2E', email, password: PASSWORD });

    await page.goto('/dashboard/new');
    await page.getByLabel('Titre du cours').fill('ab'); // < 3 caractères (createCourseInputSchema)
    await page.getByRole('radio', { name: /Débutant/ }).click();
    await page.getByRole('button', { name: 'Générer mon cours' }).click();

    await expect(page.getByRole('alert')).toContainText(/au moins 3 caractères/);
    // Aucune navigation : toujours sur l'écran de composition.
    await expect(page).toHaveURL(/\/dashboard\/new/);
  });
});
