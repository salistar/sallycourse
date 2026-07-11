// Adapter Skillshare (Prompt 41) — Skillshare = VIDÉO uniquement. Pilotage via
// Playwright (chromium headless partagé). Flow : login → création de la classe
// → upload des vidéos de leçons → génération d'un « projet de classe » à partir
// du TP principal (via callClaudeJson) → publication.
//
// Spécificités :
//   - Les leçons non-vidéo (articles, TP, quiz) ne peuvent pas être des vidéos :
//     elles sont converties en « ressources jointes » (articleToResource) et
//     listées dans la description / les ressources de la classe.
//   - Le projet de classe (obligatoire sur Skillshare) est dérivé du TP
//     principal (selectMainTp) : on demande à Claude un titre + un énoncé pas
//     à pas via callClaudeJson (mock déterministe hors-ligne).
//
// Auth : credentials.email + credentials.password (kind 'password').
// Mode mock : aucun navigateur, aucun appel Claude réel (fixture), logs « [mock] ».

import { z } from 'zod';
import {
  presignedGetUrl,
  type DeploymentMode,
  type ILesson,
} from '../../shared.js';
import { callClaudeJson } from '../../lib/claude.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { articleToResource, isVideoLesson, selectMainTp, withBrowserPage } from './lesson-transforms.js';

const SKILLSHARE_BASE = 'https://www.skillshare.com';

/** Schéma du projet de classe généré par Claude. */
const classProjectSchema = z.object({
  title: z.string().min(1),
  brief: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
});
export type ClassProject = z.infer<typeof classProjectSchema>;

/**
 * Génère le projet de classe Skillshare à partir du TP principal. Retourne un
 * projet par défaut si aucun TP n'est présent. Isolé pour la testabilité :
 * callClaudeJson est déterministe en mock.
 */
export async function generateClassProject(course: { title: string }, mainTp: ILesson | null): Promise<ClassProject> {
  if (!mainTp) {
    return {
      title: `Projet : ${course.title}`,
      brief: `Mettez en pratique les acquis du cours « ${course.title} ».`,
      steps: ['Reprenez les notions clés du cours.', 'Réalisez votre propre version.', 'Partagez le résultat.'],
    };
  }
  return callClaudeJson<ClassProject>({
    schema: classProjectSchema,
    system:
      'Tu conçois un projet de classe Skillshare à partir d’un TP de cours. ' +
      'Réponds en JSON { title, brief, steps[] } — un énoncé actionnable et pas à pas.',
    user: `Cours : ${course.title}\nTP principal : ${mainTp.title}\n${mainTp.summary ?? ''}`,
  });
}

export class SkillshareAdapter extends BaseDeploymentAdapter {
  platform = 'skillshare';
  capabilities = { modes: ['auto', 'assisted'] as DeploymentMode[], needsBrowser: true };

  private classProject: ClassProject | null = null;

  private hasCreds(ctx: DeployContext): boolean {
    return Boolean(ctx.credentials.email && ctx.credentials.password);
  }

  /** Helper partagé P112 (voir lesson-transforms.ts, même pattern que Podia). */
  private withBrowser<T>(_ctx: DeployContext, fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
    return withBrowserPage(fn);
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!this.hasCreds(ctx)) throw new Error('Skillshare : email/password manquants');
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${SKILLSHARE_BASE}/login`, { waitUntil: 'domcontentloaded' });
              // Anti-phishing (P126) : le domaine AVANT saisie doit être skillshare.com.
              this.assertExpectedDomain(page.url(), 'skillshare.com');
              await page.fill('input[name="email"]', ctx.credentials.email!);
              await page.fill('input[name="password"]', ctx.credentials.password!);
              await page.click('button[type="submit"]');
              await page.waitForLoadState('networkidle');
            }),
          'skillshare.login',
        );
        await this.log(ctx, 'info', 'Skillshare : session ouverte', 4);
      },
      async () => {
        await this.log(ctx, 'info', 'Skillshare : authentification simulée', 4);
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
              await page.goto(`${SKILLSHARE_BASE}/teach/classes/new`, { waitUntil: 'domcontentloaded' });
              await page.fill('input[name="class[title]"]', ctx.course.title);
              await page.click('button[type="submit"]');
              await page.waitForLoadState('networkidle');
              const match = /\/classes\/([^/]+)/.exec(page.url());
              if (!match) throw new Error('Skillshare : ID de classe introuvable');
              return match[1]!;
            }),
          'skillshare.createClass',
        );
        await this.log(ctx, 'info', `Skillshare : classe créée (${externalId})`, 15);
        return { externalId };
      },
      async () => {
        const id = `ss_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}`;
        await this.log(ctx, 'info', `Skillshare : classe simulée (${id})`, 15);
        return { externalId: id };
      },
    );
  }

  /**
   * Skillshare n'accepte que des vidéos. Une leçon vidéo est uploadée comme
   * unité de la classe ; une leçon non-vidéo est convertie en ressource jointe
   * (leçon lecture / document), listée dans la description de la classe.
   */
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    if (!isVideoLesson(lesson)) {
      const resource = articleToResource(lesson, index);
      await this.log(
        ctx,
        'info',
        `Skillshare : « ${lesson.title} » (${lesson.type}) → ressource jointe ${resource.filename}`,
      );
      return;
    }
    await this.guardMock(
      ctx,
      async () => {
        const videoUrl = await presignedGetUrl(lesson.assets!.videoUrl!, 3600);
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${SKILLSHARE_BASE}/teach/classes/${ctx.externalId}/lessons/new`, {
                waitUntil: 'domcontentloaded',
              });
              await page.fill('input[name="lesson[title]"]', lesson.title);
              await page.fill('input[name="lesson[video_url]"]', videoUrl);
              await page.click('button[type="submit"]');
              await page.waitForLoadState('networkidle');
            }),
          `skillshare.uploadVideo.${index}`,
        );
        await this.log(ctx, 'info', `Skillshare : vidéo « ${lesson.title} » uploadée`);
      },
      async () => {
        await this.log(ctx, 'info', `Skillshare : vidéo « ${lesson.title} » uploadée`);
      },
    );
  }

  /**
   * Renseigne la description de la classe ET génère le projet de classe (source
   * = TP principal) via Claude. Le projet est obligatoire côté Skillshare.
   */
  async setLandingPage(ctx: DeployContext): Promise<void> {
    const mainTp = selectMainTp(ctx.lessons);
    this.classProject = await generateClassProject(ctx.course, mainTp);
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${SKILLSHARE_BASE}/teach/classes/${ctx.externalId}/project`, {
                waitUntil: 'domcontentloaded',
              });
              await page.fill('input[name="project[title]"]', this.classProject!.title);
              await page.fill('textarea[name="project[brief]"]', this.classProject!.brief);
            }),
          'skillshare.project',
        );
        await this.log(ctx, 'info', `Skillshare : projet de classe « ${this.classProject!.title} » défini`, 80);
      },
      async () => {
        await this.log(ctx, 'info', `Skillshare : projet de classe « ${this.classProject!.title} » simulé`, 80);
      },
    );
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () =>
            this.withBrowser(ctx, async (page) => {
              await page.goto(`${SKILLSHARE_BASE}/teach/classes/${ctx.externalId}/publish`, {
                waitUntil: 'domcontentloaded',
              });
              await page.click('button[data-action="submit-review"]');
              await page.waitForLoadState('networkidle');
            }),
          'skillshare.submit',
        );
        await this.log(ctx, 'info', 'Skillshare : classe soumise à la revue', 92);
      },
      async () => {
        await this.log(ctx, 'info', 'Skillshare : soumission simulée', 92);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const url = `${SKILLSHARE_BASE}/classes/${ctx.externalId}`;
    // Skillshare passe par une revue : on rapporte l'état « en revue ».
    return this.guardMock(
      ctx,
      async () => ({ status: 'running', externalUrl: url, reviewState: 'in_review' }),
      async () => ({ status: 'running', externalUrl: url, reviewState: 'in_review' }),
    );
  }
}

registerAdapter(new SkillshareAdapter());
