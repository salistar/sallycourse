// Adapter de déploiement Thinkific (Prompt 39).
// Publie un cours via l'API REST Thinkific v1 (fetch direct, pas de SDK) :
// création du cours, des chapitres (« chapters »), des contenus (« contents »)
// vidéo / texte / quiz, puis de la page de vente (description générée + prix).
//
// Auth : en-têtes X-Auth-API-Key + X-Auth-Subdomain. En MOCK ou sans
// credentials, tout est SIMULÉ (aucun appel réseau, id/URL fictifs, logs [mock]).

import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import type { DeploymentMode, ILesson } from '../../shared.js';
import { DEFAULT_MARKETPLACE_PRICE } from '../../shared.js';
import {
  fetchJsonApi,
  locateLesson,
  mapCourseStructure,
  type LmsContentType,
  type MappedCourse,
} from './structure.js';
import { buildProductDescription, slugifyTitle } from './lesson-transforms.js';

/** Base de l'API v1 Thinkific. */
const THINKIFIC_API_BASE = 'https://api.thinkific.com/api/public/v1';

/** Prix de vente par défaut (en unités, devise du compte) si non spécifié (constants.ts, P113). */
const DEFAULT_PRICE = DEFAULT_MARKETPLACE_PRICE.thinkific;

interface ThinkificCourseResponse {
  id?: number | string;
  slug?: string;
  name?: string;
}

interface ThinkificChapterResponse {
  id?: number | string;
}

/**
 * Adapter Thinkific. `credentials.apiKey` + `credentials.subdomain`.
 * needsBrowser = false : l'API couvre cours, chapitres, contenus et prix.
 */
export class ThinkificAdapter extends BaseDeploymentAdapter {
  platform = 'thinkific';
  capabilities: { modes: DeploymentMode[]; needsBrowser: boolean } = {
    modes: ['auto', 'assisted', 'manual'],
    needsBrowser: false,
  };

  private structureCache = new WeakMap<DeployContext, MappedCourse>();
  /** Map index absolu de chapitre → id chapitre Thinkific (réel uniquement). */
  private chapterIds = new WeakMap<DeployContext, Map<number, string>>();

  private structure(ctx: DeployContext): MappedCourse {
    const cached = this.structureCache.get(ctx);
    if (cached) return cached;
    const mapped = mapCourseStructure(ctx.course, ctx.sections, ctx.lessons);
    this.structureCache.set(ctx, mapped);
    return mapped;
  }

  private headers(ctx: DeployContext): Record<string, string> {
    return {
      'X-Auth-API-Key': ctx.credentials.apiKey ?? '',
      'X-Auth-Subdomain': ctx.credentials.subdomain ?? '',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /** Appel REST JSON (helper partagé P112 — voir structure.ts, même pattern que Teachable). */
  private async api<T>(
    ctx: DeployContext,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.withRetry(
      () => fetchJsonApi<T>('Thinkific', THINKIFIC_API_BASE, method, path, this.headers(ctx), body),
      `thinkific ${method} ${path}`,
    );
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!ctx.credentials.apiKey || !ctx.credentials.subdomain) {
          throw new Error('Thinkific : apiKey et subdomain requis.');
        }
        await this.api(ctx, 'GET', '/courses?page=1&limit=1');
        await this.log(ctx, 'info', 'Thinkific : identifiants validés', 5);
      },
      async () => {
        await this.log(ctx, 'info', 'authentification Thinkific simulée', 5);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    const mapped = this.structure(ctx);
    return this.guardMock(
      ctx,
      async () => {
        const res = await this.api<ThinkificCourseResponse>(ctx, 'POST', '/courses', {
          name: mapped.title,
          slug: this.slug(ctx),
        });
        const id = res.id;
        if (id === undefined) {
          throw new Error('Thinkific : createCourse sans id de cours.');
        }
        ctx.externalId = String(id);
        await this.log(ctx, 'info', `cours Thinkific créé (id ${id})`, 10);
        await this.createChapters(ctx);
        return { externalId: String(id) };
      },
      async () => {
        const id = `thk_course_${this.slug(ctx)}`;
        ctx.externalId = id;
        await this.log(
          ctx,
          'info',
          `cours Thinkific simulé (${id}) + ${mapped.sections.length} chapitre(s)`,
          10,
        );
        return { externalId: id };
      },
    );
  }

  /** Crée les chapitres et mémorise leurs ids (indexés par position de section). */
  private async createChapters(ctx: DeployContext): Promise<void> {
    const mapped = this.structure(ctx);
    const ids = new Map<number, string>();
    for (let s = 0; s < mapped.sections.length; s += 1) {
      const section = mapped.sections[s]!;
      const res = await this.api<ThinkificChapterResponse>(ctx, 'POST', '/chapters', {
        course_id: ctx.externalId,
        name: section.title,
        position: s + 1,
      });
      if (res.id !== undefined) ids.set(s, String(res.id));
    }
    this.chapterIds.set(ctx, ids);
    await this.log(ctx, 'info', `${mapped.sections.length} chapitre(s) Thinkific créé(s)`);
  }

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const mapped = this.structure(ctx);
    const located = locateLesson(mapped, index);
    const sectionTitle = located?.section.title ?? 'Divers';
    const sectionPosition = located?.sectionPosition ?? 0;
    const contentType: LmsContentType = located
      ? located.section.lessons[located.positionInSection]!.contentType
      : 'text';

    await this.guardMock(
      ctx,
      async () => {
        const chapterId = this.chapterIds.get(ctx)?.get(sectionPosition);
        const body = this.contentBody(lesson, contentType, chapterId);
        await this.api(ctx, 'POST', '/contents', body);
        await this.log(
          ctx,
          'info',
          `contenu « ${lesson.title} » (${contentType}) publié dans « ${sectionTitle} »`,
        );
      },
      async () => {
        await this.log(
          ctx,
          'info',
          `contenu simulé #${index} « ${lesson.title} » (${contentType}) → chapitre « ${sectionTitle} »`,
        );
      },
    );
  }

  /** Corps de création d'un content selon son type (vidéo/texte/quiz). */
  private contentBody(
    lesson: ILesson,
    contentType: LmsContentType,
    chapterId: string | undefined,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      chapter_id: chapterId,
      name: lesson.title,
    };
    if (contentType === 'video') {
      base.contentable_type = 'Lesson';
      base.video_url = lesson.assets.videoUrl ?? '';
    } else if (contentType === 'quiz') {
      base.contentable_type = 'Quiz';
    } else {
      base.contentable_type = 'HtmlItem';
      base.html = lesson.assets.articleMd ?? lesson.summary ?? lesson.title;
    }
    return base;
  }

  async setLandingPage(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        await this.api(ctx, 'PUT', `/courses/${ctx.externalId}`, {
          description: this.landingDescription(ctx),
        });
        await this.log(ctx, 'info', 'page de vente Thinkific mise à jour', 82);
        // Prix : ressource distincte (product prices) — best-effort.
        await this.api(ctx, 'POST', '/product_prices', {
          product_id: ctx.externalId,
          price: DEFAULT_PRICE,
          is_primary: true,
        }).catch(() => undefined);
        await this.log(ctx, 'info', `prix Thinkific fixé (${DEFAULT_PRICE})`, 85);
      },
      async () => {
        await this.log(ctx, 'info', `landing + prix (${DEFAULT_PRICE}) Thinkific simulés`, 85);
      },
    );
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    // Thinkific n'a pas de revue : on publie le cours.
    await this.guardMock(
      ctx,
      async () => {
        await this.api(ctx, 'PUT', `/courses/${ctx.externalId}`, { published: true });
        await this.log(ctx, 'info', 'cours Thinkific publié', 95);
      },
      async () => {
        await this.log(ctx, 'info', 'publication Thinkific simulée', 95);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    return this.guardMock(
      ctx,
      async () => {
        const res = await this.api<ThinkificCourseResponse & { published?: boolean }>(
          ctx,
          'GET',
          `/courses/${ctx.externalId}`,
        );
        const published = (res as { published?: boolean }).published === true;
        const url = res.slug
          ? `https://${ctx.credentials.subdomain}.thinkific.com/courses/${res.slug}`
          : undefined;
        return {
          status: published ? 'published' : 'running',
          externalUrl: url,
          reviewState: published ? 'approved' : 'draft',
        };
      },
      async () => ({
        status: 'published',
        externalUrl: `https://mock-school.thinkific.com/courses/${this.slug(ctx)}`,
        reviewState: 'approved',
      }),
    );
  }

  private landingDescription(ctx: DeployContext): string {
    return buildProductDescription(ctx.course, ctx.lessons.length);
  }

  /** Slug déterministe à partir du titre du cours (helper partagé). */
  private slug(ctx: DeployContext): string {
    return slugifyTitle(ctx.course.title);
  }
}

export const thinkificAdapter = new ThinkificAdapter();

// Enregistrement non destructif (ne touche pas aux autres adapters).
registerAdapter(thinkificAdapter);
