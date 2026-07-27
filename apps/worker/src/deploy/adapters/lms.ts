// Adapter de déploiement « LMS interne » (Prompt 43). Contrairement aux autres
// adapters (Udemy, YouTube…) il ne pousse RIEN vers l'extérieur : « publier »
// = rendre le cours visible dans le catalogue interne /learn. Concrètement, on
// upsert un LmsListing (published:true) pointant vers le cours ; tout le contenu
// (vidéos, articles, quiz) est déjà en base/stockage. Aucun upload de leçon.
//
// Le flow générique du processor reste respecté : authenticate (no-op),
// createCourse (upsert du listing), uploadLesson (no-op par leçon — le contenu
// est déjà là), setLandingPage (résumé/couverture), submitForReview (no-op :
// pas de modération externe), getStatus ('published' + URL /learn/{courseId}).
// En mock : aucune écriture réseau, mais l'upsert Mongo local reste fait pour
// rester testable ; les logs sont préfixés « [mock] » par la classe de base.

import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import { enqueueBlogGeneration } from '../../lib/blog.js';
import { LmsListing, Course } from '../../shared.js';
import type { DeploymentMode, ILesson } from '../../shared.js';
import type { DeployContext, DeployStatus } from '../types.js';

/** Base publique du LMS interne (surchargeable via env LMS_BASE_URL). */
function lmsBaseUrl(): string {
  const raw = process.env.LMS_BASE_URL?.trim();
  return (raw && raw.replace(/\/+$/, '')) || '';
}

/** URL publique de la fiche cours dans le catalogue /learn. */
function learnUrl(courseId: string): string {
  return `${lmsBaseUrl()}/learn/${courseId}`;
}

/** Résumé marketing court : 1re phrase de la description outline, sinon le titre. */
function deriveSummary(ctx: DeployContext): string {
  const outline = (ctx.course as { outline?: { description?: unknown } }).outline;
  const desc = outline && typeof outline === 'object' ? outline.description : undefined;
  if (typeof desc === 'string' && desc.trim()) {
    const firstSentence = desc.trim().split(/(?<=[.!?])\s/)[0] ?? desc.trim();
    return firstSentence.slice(0, 280);
  }
  return ctx.course.title;
}

/** Durée totale (min) = somme des durées de leçons connues. */
function totalDuration(lessons: ILesson[]): number {
  return lessons.reduce((sum, l) => sum + (l.durationMin ?? 0), 0);
}

export class LmsAdapter extends BaseDeploymentAdapter {
  platform = 'internal';
  capabilities: { modes: DeploymentMode[]; needsBrowser: boolean } = {
    // LMS interne : tout est automatique, jamais besoin d'un navigateur.
    modes: ['auto', 'assisted', 'manual'],
    needsBrowser: false,
  };

  /** Pas de session externe : le LMS interne s'appuie sur la base locale. */
  async authenticate(ctx: DeployContext): Promise<void> {
    await this.log(ctx, 'info', 'LMS interne : aucune authentification externe requise', 2);
  }

  /**
   * « Crée » le cours côté LMS = upsert du LmsListing (brouillon, published
   * passe à true seulement à submitForReview). externalId = courseId lui-même.
   */
  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const listing = await this.guardMock(
      ctx,
      async () =>
        LmsListing.findOneAndUpdate(
          { courseId },
          {
            $set: {
              userId: ctx.deployment.userId,
              title: ctx.course.title,
              lessonCount: ctx.lessons.length,
              durationMin: totalDuration(ctx.lessons),
            },
            // Ne (re)publie pas ici : la publication est décidée à submitForReview.
            $setOnInsert: { published: false, priceCents: 0, currency: 'MAD' },
          },
          { upsert: true, new: true },
        ),
      () => null,
    );
    await this.log(ctx, 'info', `Fiche catalogue préparée (${ctx.lessons.length} leçons)`, 15);
    return { externalId: String(listing?.courseId ?? courseId) };
  }

  /**
   * Aucun upload par leçon : le contenu (vidéo/article/quiz) est déjà en base
   * et en stockage. On journalise simplement pour la traçabilité du flow.
   */
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    await this.log(ctx, 'info', `Leçon ${index + 1} « ${lesson.title} » déjà en base (aucun upload)`);
  }

  /** Renseigne résumé + couverture de la fiche catalogue. */
  async setLandingPage(ctx: DeployContext): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const summary = deriveSummary(ctx);
    const coverImageKey = ctx.course.coverImageUrl || undefined;
    await this.guardMock(
      ctx,
      async () => {
        await LmsListing.updateOne({ courseId }, { $set: { summary, coverImageKey } });
      },
      () => undefined,
    );
    await this.log(ctx, 'info', 'Résumé et couverture du catalogue renseignés', 80);
  }

  /**
   * « Soumission à la revue » = publication immédiate sur le LMS interne
   * (pas de modération externe) : LmsListing.published=true + publishedAt, et
   * Course.status='published' pour refléter l'état dans le tableau de bord.
   *
   * C'est AUSSI le point de déclenchement du blog SEO (P204) : la génération
   * des articles est enfilée (jamais exécutée en ligne) et reste BEST-EFFORT —
   * un échec de mise en file n'empêche jamais la publication du cours.
   */
  async submitForReview(ctx: DeployContext): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    await this.guardMock(
      ctx,
      async () => {
        await LmsListing.updateOne(
          { courseId },
          { $set: { published: true, publishedAt: new Date() } },
        );
        await Course.updateOne({ _id: courseId }, { $set: { status: 'published' } });
        await enqueueBlogGeneration(courseId);
      },
      () => undefined,
    );
    await this.log(ctx, 'info', 'Cours publié sur le LMS interne (catalogue /learn)', 92);
  }

  /** Statut final : toujours 'published' (aucune revue asynchrone). */
  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    return {
      status: 'published',
      externalUrl: learnUrl(courseId),
      reviewState: 'published',
    };
  }
}

/** Instance unique exportée (tests) + auto-enregistrement à l'import. */
export const lmsAdapter = new LmsAdapter();
registerAdapter(lmsAdapter);
