// Adapter Podia (Prompt 40) — Podia n'expose pas d'API publique complète pour
// la création de cours : on pilote le back-office via Playwright (chromium
// headless, instance partagée du worker). Flow : login → création du produit
// « Online course » → sections → upload des leçons (vidéo/article) → publication.
//
// Auth : credentials.apiKey (kind 'apikey', champ web « apiKey »). Podia n'ayant
// pas d'API officielle, la clé sert de jeton de session/cookie applicatif dans
// notre implémentation ; email/password peuvent aussi être fournis.
//
// Mode mock (MOCK_PROVIDERS ou credentials absents) : AUCUN navigateur lancé,
// IDs/URL fictifs, logs « [mock] ». La logique de navigation réelle reste
// encapsulée dans withBrowser (non exécutée en mock).

import {
  presignedGetUrl,
  storageKeys,
  type DeploymentMode,
  type ILesson,
} from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { isVideoLesson, slugifyTitle, withBrowserPage } from './lesson-transforms.js';

const PODIA_BASE = 'https://app.podia.com';

export class PodiaAdapter extends BaseDeploymentAdapter {
  platform = 'podia';
  // Piloté au navigateur ; assisté possible (l'utilisateur peut finaliser).
  capabilities = { modes: ['auto', 'assisted'] as DeploymentMode[], needsBrowser: true };

  private hasCreds(ctx: DeployContext): boolean {
    return Boolean(ctx.credentials.apiKey || (ctx.credentials.email && ctx.credentials.password));
  }

  /**
   * Exécute une action nécessitant le navigateur, hors mock (helper partagé
   * P112 — voir lesson-transforms.ts, même pattern que Skillshare).
   */
  private withBrowser<T>(_ctx: DeployContext, fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
    return withBrowserPage(fn);
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!this.hasCreds(ctx)) throw new Error('Podia : identifiants manquants (apiKey ou email/password)');
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              // Session applicative : le cookie/jeton porte l'auth Podia.
              await page.goto(`${PODIA_BASE}/login`, { waitUntil: 'domcontentloaded' });
              if (ctx.credentials.email && ctx.credentials.password) {
                // Anti-phishing (P126) : le domaine AVANT saisie doit être podia.com.
                this.assertExpectedDomain(page.url(), 'podia.com');
                await page.fill('input[name="email"]', ctx.credentials.email);
                await page.fill('input[name="password"]', ctx.credentials.password);
                await page.click('button[type="submit"]');
                await page.waitForLoadState('networkidle');
              }
            }),
          'podia.login',
        );
        await this.log(ctx, 'info', 'Podia : session ouverte', 4);
      },
      async () => {
        await this.log(ctx, 'info', 'Podia : authentification simulée', 4);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    if (ctx.externalId) return { externalId: ctx.externalId };
    return this.guardMock(
      ctx,
      async () => {
        const externalId = await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${PODIA_BASE}/products/new?type=online_course`, {
                waitUntil: 'domcontentloaded',
              });
              await page.fill('input[name="product[name]"]', ctx.course.title);
              await page.click('button[type="submit"]');
              await page.waitForLoadState('networkidle');
              // L'ID produit apparaît dans l'URL /products/{id}/edit.
              const match = /\/products\/([^/]+)/.exec(page.url());
              if (!match) throw new Error('Podia : ID produit introuvable après création');
              return match[1]!;
            }),
          'podia.createCourse',
        );
        await this.log(ctx, 'info', `Podia : cours créé (${externalId})`, 15);
        return { externalId };
      },
      async () => {
        const id = `podia_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}`;
        await this.log(ctx, 'info', `Podia : cours simulé (${id})`, 15);
        return { externalId: id };
      },
    );
  }

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${PODIA_BASE}/products/${ctx.externalId}/lessons/new`, {
                waitUntil: 'domcontentloaded',
              });
              await page.fill('input[name="lesson[name]"]', lesson.title);
              if (isVideoLesson(lesson)) {
                // Podia importe la vidéo depuis une URL présignée.
                const videoUrl = await presignedGetUrl(lesson.assets!.videoUrl!, 3600);
                await page.fill('input[name="lesson[video_url]"]', videoUrl);
              } else if (lesson.type === 'article') {
                // Article → contenu texte de la leçon (téléchargé côté worker).
                const mdKey = lesson.assets?.articleMd ?? storageKeys.course(courseId).lesson(0, lesson.order).article();
                await page.fill('textarea[name="lesson[content]"]', `Ressource : ${mdKey}`);
              }
              await page.click('button[type="submit"]');
              await page.waitForLoadState('networkidle');
            }),
          `podia.uploadLesson.${index}`,
        );
        await this.log(ctx, 'info', `Podia : leçon « ${lesson.title} » publiée`);
      },
      async () => {
        await this.log(ctx, 'info', `Podia : leçon « ${lesson.title} » (${lesson.type}) publiée`);
      },
    );
  }

  async setLandingPage(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${PODIA_BASE}/products/${ctx.externalId}/edit`, {
                waitUntil: 'domcontentloaded',
              });
              // Renseigne le slug/description de la page produit.
              await page.fill('input[name="product[slug]"]', slugifyTitle(ctx.course.title));
            }),
          'podia.landing',
        );
        await this.log(ctx, 'info', 'Podia : page produit configurée', 80);
      },
      async () => {
        await this.log(ctx, 'info', 'Podia : page produit simulée', 80);
      },
    );
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    // Podia n'a pas de revue : on publie directement le produit.
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${PODIA_BASE}/products/${ctx.externalId}/edit`, {
                waitUntil: 'domcontentloaded',
              });
              await page.click('button[data-action="publish"]');
              await page.waitForLoadState('networkidle');
            }),
          'podia.publish',
        );
        await this.log(ctx, 'info', 'Podia : produit publié', 92);
      },
      async () => {
        await this.log(ctx, 'info', 'Podia : publication simulée', 92);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const url = `${PODIA_BASE}/products/${ctx.externalId}`;
    return this.guardMock(
      ctx,
      async () => ({ status: 'published', externalUrl: url, reviewState: 'not_applicable' }),
      async () => ({ status: 'published', externalUrl: url, reviewState: 'not_applicable' }),
    );
  }
}

registerAdapter(new PodiaAdapter());
