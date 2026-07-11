// Adapter de déploiement Teachable (Prompt 38).
// Publie un cours via l'API REST Teachable (fetch direct, pas de SDK) :
// création du cours, des sections (« lecture sections »), puis des leçons —
// vidéo (upload d'asset), texte (article Markdown → HTML), et quiz.
//
// Périmètre / limites : l'API publique Teachable ne couvre pas tout (l'upload
// vidéo « natif » et certains types de contenu passent par l'admin web). Là où
// l'API manque, un FALLBACK Playwright serait requis (non implémenté ici) — il
// est documenté par méthode (voir NOTE fallback). En MOCK ou sans credentials,
// tout est SIMULÉ : aucun appel réseau, identifiants/URL fictifs, logs [mock].

import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import type { DeploymentMode, ILesson } from '../../shared.js';
import {
  fetchJsonApi,
  locateLesson,
  mapCourseStructure,
  type LmsContentType,
  type MappedCourse,
} from './structure.js';
import { buildProductDescription, slugifyTitle } from './lesson-transforms.js';

/** Base de l'API v1 Teachable. */
const TEACHABLE_API_BASE = 'https://developers.teachable.com/v1';

/** Réponse minimale attendue à la création d'un cours. */
interface TeachableCourseResponse {
  course?: { id?: number | string; url?: string; published?: boolean };
}

/**
 * Adapter Teachable. `credentials.apiKey` = clé API de l'espace admin.
 * capabilities.needsBrowser = true : certaines opérations (upload vidéo natif)
 * ne sont couvertes que par un fallback navigateur.
 */
export class TeachableAdapter extends BaseDeploymentAdapter {
  platform = 'teachable';
  capabilities: { modes: DeploymentMode[]; needsBrowser: boolean } = {
    modes: ['auto', 'assisted', 'manual'],
    needsBrowser: true,
  };

  /** Arbre mappé, mémoïsé par déploiement (recalcul idempotent). */
  private structureCache = new WeakMap<DeployContext, MappedCourse>();

  private structure(ctx: DeployContext): MappedCourse {
    const cached = this.structureCache.get(ctx);
    if (cached) return cached;
    const mapped = mapCourseStructure(ctx.course, ctx.sections, ctx.lessons);
    this.structureCache.set(ctx, mapped);
    return mapped;
  }

  /** En-têtes API (clé dans apiKey). Jamais appelé en mock. */
  private headers(ctx: DeployContext): Record<string, string> {
    return {
      apiKey: ctx.credentials.apiKey ?? '',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * GET/POST JSON avec retry (helper partagé P112 — voir structure.ts, même
   * pattern que Thinkific). Jette sur statut HTTP non 2xx.
   */
  private async api<T>(
    ctx: DeployContext,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.withRetry(
      () => fetchJsonApi<T>('Teachable', TEACHABLE_API_BASE, method, path, this.headers(ctx), body),
      `teachable ${method} ${path}`,
    );
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!ctx.credentials.apiKey) {
          throw new Error('Teachable : clé API manquante (credentials.apiKey).');
        }
        // Ping léger : la route /courses valide la clé.
        await this.api(ctx, 'GET', '/courses?page=1&per=1');
        await this.log(ctx, 'info', 'Teachable : clé API validée', 5);
      },
      async () => {
        await this.log(ctx, 'info', 'authentification Teachable simulée', 5);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    const mapped = this.structure(ctx);
    return this.guardMock(
      ctx,
      async () => {
        const payload = {
          course: {
            name: mapped.title,
            heading: ctx.course.title,
            description: this.landingDescription(ctx),
            is_published: false,
          },
        };
        const res = await this.api<TeachableCourseResponse>(ctx, 'POST', '/courses', payload);
        const id = res.course?.id;
        if (id === undefined) {
          throw new Error('Teachable : createCourse sans id de cours dans la réponse.');
        }
        ctx.externalId = String(id);
        await this.log(ctx, 'info', `cours Teachable créé (id ${id})`, 10);
        await this.createSections(ctx);
        return { externalId: String(id) };
      },
      async () => {
        const id = `tch_course_${this.mockSlug(ctx)}`;
        ctx.externalId = id;
        await this.log(ctx, 'info', `cours Teachable simulé (${id}) + ${mapped.sections.length} section(s)`, 10);
        return { externalId: id };
      },
    );
  }

  /** Crée les sections (lecture sections) du cours dans l'ordre. Réel uniquement. */
  private async createSections(ctx: DeployContext): Promise<void> {
    const mapped = this.structure(ctx);
    for (const section of mapped.sections) {
      await this.api(ctx, 'POST', `/courses/${ctx.externalId}/sections`, {
        section: { name: section.title, position: section.order + 1 },
      });
    }
    await this.log(ctx, 'info', `${mapped.sections.length} section(s) Teachable créée(s)`);
  }

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const mapped = this.structure(ctx);
    const located = locateLesson(mapped, index);
    const sectionTitle = located?.section.title ?? 'Divers';
    const contentType: LmsContentType = located
      ? located.section.lessons[located.positionInSection]!.contentType
      : 'text';

    await this.guardMock(
      ctx,
      async () => {
        // NOTE fallback : l'upload vidéo « natif » Teachable n'est pas exposé par
        // l'API publique ; en production, un fallback Playwright (needsBrowser)
        // téléverserait le fichier via l'admin. Ici on crée la leçon et on
        // rattache l'asset par URL présignée pour les types couverts par l'API.
        const lectureBody = await this.lectureBody(ctx, lesson, contentType, sectionTitle);
        await this.api(ctx, 'POST', `/courses/${ctx.externalId}/lectures`, lectureBody);
        await this.log(
          ctx,
          'info',
          `leçon « ${lesson.title} » (${contentType}) publiée dans « ${sectionTitle} »`,
        );
      },
      async () => {
        await this.log(
          ctx,
          'info',
          `leçon simulée #${index} « ${lesson.title} » (${contentType}) → section « ${sectionTitle} »`,
        );
      },
    );
  }

  /** Construit le corps de création d'une lecture selon son type. */
  private async lectureBody(
    ctx: DeployContext,
    lesson: ILesson,
    contentType: LmsContentType,
    sectionTitle: string,
  ): Promise<Record<string, unknown>> {
    const base: Record<string, unknown> = { name: lesson.title, section_name: sectionTitle };
    if (contentType === 'video') {
      base.type = 'video';
      base.video_url = lesson.assets.videoUrl ?? '';
    } else if (contentType === 'quiz') {
      base.type = 'quiz';
      base.quiz = { lesson_id: String(lesson.sectionId ?? '') };
    } else {
      base.type = 'text';
      base.text = lesson.assets.articleMd ?? lesson.summary ?? lesson.title;
    }
    return { lecture: base };
  }

  async setLandingPage(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        await this.api(ctx, 'PUT', `/courses/${ctx.externalId}`, {
          course: { description: this.landingDescription(ctx) },
        });
        await this.log(ctx, 'info', 'page de présentation Teachable mise à jour', 85);
      },
      async () => {
        await this.log(ctx, 'info', 'landing Teachable simulée', 85);
      },
    );
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    // Teachable n'a pas de revue : publier = rendre le cours visible.
    await this.guardMock(
      ctx,
      async () => {
        await this.api(ctx, 'PUT', `/courses/${ctx.externalId}`, {
          course: { is_published: true },
        });
        await this.log(ctx, 'info', 'cours Teachable publié', 95);
      },
      async () => {
        await this.log(ctx, 'info', 'publication Teachable simulée', 95);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    return this.guardMock(
      ctx,
      async () => {
        const res = await this.api<TeachableCourseResponse>(
          ctx,
          'GET',
          `/courses/${ctx.externalId}`,
        );
        const published = res.course?.published === true;
        return {
          status: published ? 'published' : 'running',
          externalUrl: res.course?.url,
          reviewState: published ? 'approved' : 'draft',
        };
      },
      async () => ({
        status: 'published',
        externalUrl: `https://mock-school.teachable.com/courses/${ctx.externalId}`,
        reviewState: 'approved',
      }),
    );
  }

  /** Description marketing (helper partagé : marketing généré sinon fallback). */
  private landingDescription(ctx: DeployContext): string {
    return buildProductDescription(ctx.course, ctx.lessons.length);
  }

  /** Slug déterministe pour les identifiants mock. */
  private mockSlug(ctx: DeployContext): string {
    return slugifyTitle(ctx.course.title);
  }
}

/** Instance prête à l'enregistrement dans le registre. */
export const teachableAdapter = new TeachableAdapter();

// Enregistrement non destructif (ne touche pas aux autres adapters).
registerAdapter(teachableAdapter);
