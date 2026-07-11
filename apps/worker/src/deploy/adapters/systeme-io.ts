// Adapter Systeme.io (Prompt 104) — API REST officielle (developer.systeme.io) :
// crée le cours + modules + leçons, ET un tunnel de vente complet généré par
// Claude (mock-friendly) :
//   - page de capture (titre accrocheur + argumentaire) ;
//   - séquence email de nurturing sur 5 jours ({subject, body, sendDelayDays}) ;
//   - page de vente (réutilise marketingSchema existant, P28).
//
// LIMITATION DOCUMENTÉE : l'API publique Systeme.io (v20250101) expose la
// gestion des cours (courses/modules/lessons) mais AUCUN endpoint funnels/
// emails/campagnes — ces objets ne sont pilotables que depuis le back-office
// web. Le tunnel généré est donc stocké comme export JSON téléchargeable
// (storageKeys…exportFile) : l'utilisateur l'importe manuellement (copier-
// coller) dans l'éditeur Systeme.io. Si l'API expose un jour ces endpoints,
// seule pushFunnelIfSupported() a besoin d'évoluer (reste du flow inchangé).
//
// Auth : credentials.apiKey (kind 'apikey', en-tête `X-API-Key`).
// Mode mock (MOCK_PROVIDERS ou credentials absents) : aucun appel réseau réel
// (ni Systeme.io ni Claude), IDs/URL fictifs, logs « [mock] ».

import { z } from 'zod';
import {
  getConfig,
  marketingSchema,
  storageKeys,
  uploadObject,
  type DeploymentMode,
  type ILesson,
  type MarketingContent,
} from '../../shared.js';
import { callClaudeJson } from '../../lib/claude.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { buildProductDescription } from './lesson-transforms.js';

const API = 'https://api.systeme.io/api';
/** Nombre de jours de la séquence de nurturing. */
export const EMAIL_SEQUENCE_DAYS = 5;
/** Nom du fichier d'export du tunnel (fallback : endpoints funnels/emails absents de l'API). */
export const FUNNEL_EXPORT_FILENAME = 'systeme-io-funnel.json';

/* ------------------------------------------------------------------ */
/* Schémas du tunnel de vente généré par Claude                        */
/* ------------------------------------------------------------------ */

/** Page de capture : titre accrocheur + argumentaire (bullet points bénéfices). */
export const capturePageSchema = z.object({
  headline: z.string().min(1),
  subheadline: z.string().min(1),
  benefits: z.array(z.string().min(1)).min(3),
  ctaLabel: z.string().min(1),
});
export type CapturePageContent = z.infer<typeof capturePageSchema>;

/** Un email de la séquence de nurturing (schéma imposé par le prompt). */
export const nurturingEmailSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  sendDelayDays: z.number().int().min(0),
});
export type NurturingEmail = z.infer<typeof nurturingEmailSchema>;

/** Séquence complète : EMAIL_SEQUENCE_DAYS emails, délais croissants. */
export const emailSequenceSchema = z.object({
  emails: z.array(nurturingEmailSchema).length(EMAIL_SEQUENCE_DAYS),
});
export type EmailSequence = z.infer<typeof emailSequenceSchema>;

/** Tunnel de vente complet exporté (capture + emails + page de vente). */
export interface FunnelExport {
  courseTitle: string;
  capturePage: CapturePageContent;
  emailSequence: NurturingEmail[];
  salesPage: MarketingContent;
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Génération du tunnel (Claude, mock-friendly)                        */
/* ------------------------------------------------------------------ */

/** Vrai si aucun appel réseau réel ne doit être fait (mode simulé global). */
function isMockMode(): boolean {
  const config = getConfig();
  return Boolean(config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY);
}

/** Fixture déterministe de page de capture (mode mock, aucun appel Claude). */
function mockCapturePage(courseTitle: string): CapturePageContent {
  return {
    headline: `Maîtrisez ${courseTitle} dès aujourd'hui`,
    subheadline: `La formation complète pour progresser vite sur « ${courseTitle} ».`,
    benefits: [
      'Un programme structuré, étape par étape.',
      'Des exercices pratiques immédiatement applicables.',
      'Un accès à vie au contenu et à ses mises à jour.',
    ],
    ctaLabel: 'Je réserve ma place',
  };
}

/**
 * Génère la page de capture via Claude (titre accrocheur + argumentaire).
 * Mode mock : fixture locale déterministe, aucun appel réseau.
 */
export async function generateCapturePage(courseTitle: string): Promise<CapturePageContent> {
  if (isMockMode()) return mockCapturePage(courseTitle);
  return callClaudeJson<CapturePageContent>({
    schema: capturePageSchema,
    system:
      'Tu rédiges une page de capture (landing page) pour un tunnel de vente Systeme.io. ' +
      'Réponds en JSON { headline, subheadline, benefits[] (>=3), ctaLabel } — accrocheur, orienté conversion, en français.',
    user: `Cours à promouvoir : « ${courseTitle} ».`,
  });
}

/** Fixture déterministe de séquence email (mode mock, aucun appel Claude). */
function mockEmailSequence(courseTitle: string): NurturingEmail[] {
  const steps = [
    { subject: `Bienvenue — votre parcours « ${courseTitle} » commence`, body: `Merci de votre intérêt pour « ${courseTitle} ». Voici comment bien démarrer.` },
    { subject: `Le piège n°1 à éviter`, body: `La plupart des apprenants butent sur le même point avec « ${courseTitle} » — voici comment l'éviter.` },
    { subject: `Un cas concret, pas à pas`, body: `Découvrez un exemple concret tiré de « ${courseTitle} », appliqué de bout en bout.` },
    { subject: `Ce que disent nos apprenants`, body: `Témoignages et résultats obtenus grâce à « ${courseTitle} ».` },
    { subject: `Dernière chance de rejoindre « ${courseTitle} »`, body: `L'offre de lancement de « ${courseTitle} » se termine bientôt — inscrivez-vous maintenant.` },
  ];
  return steps.map((step, i) => ({ ...step, sendDelayDays: i }));
}

/**
 * Génère la séquence email de nurturing (EMAIL_SEQUENCE_DAYS emails, schéma
 * {subject, body, sendDelayDays}). Mode mock : fixture locale déterministe.
 */
export async function generateEmailSequence(courseTitle: string): Promise<NurturingEmail[]> {
  if (isMockMode()) return mockEmailSequence(courseTitle);
  const result = await callClaudeJson<EmailSequence>({
    schema: emailSequenceSchema,
    system:
      `Tu conçois une séquence email de nurturing sur ${EMAIL_SEQUENCE_DAYS} jours pour promouvoir un cours en ligne. ` +
      `Réponds en JSON { emails: [ { subject, body, sendDelayDays } × ${EMAIL_SEQUENCE_DAYS} ] }, en français, ` +
      'avec des délais croissants (0, 1, 2… jours) et une progression pédagogique → preuve sociale → urgence.',
    user: `Cours à promouvoir : « ${courseTitle} ».`,
  });
  return result.emails;
}

/* ------------------------------------------------------------------ */
/* Requêtes API Systeme.io — construction PURE (testable hors-ligne)   */
/* ------------------------------------------------------------------ */

/** Item d'une leçon envoyé à l'API Systeme.io (POST /courses/{id}/modules/{id}/lessons). */
export interface SystemeLessonRequest {
  title: string;
  content: string;
  position: number;
}

/** Construit le corps de la requête de création de cours. */
export function buildCourseRequest(courseTitle: string, description: string): { title: string; description: string } {
  return { title: courseTitle, description };
}

/** Construit le corps de la requête de création d'un module (= section). */
export function buildModuleRequest(sectionTitle: string, position: number): { title: string; position: number } {
  return { title: sectionTitle, position };
}

/** Construit le corps de la requête de création d'une leçon, position 0-based → 1-based côté API. */
export function buildLessonRequest(lesson: { title: string; content: string }, index: number): SystemeLessonRequest {
  return { title: lesson.title, content: lesson.content, position: index + 1 };
}

/** Contenu texte d'une leçon envoyé à l'API (résumé généré, sinon résumé d'origine, sinon titre seul). */
export function lessonContentFor(lesson: ILesson): string {
  return (lesson.generatedSummary ?? lesson.summary ?? lesson.title).trim();
}

/* ------------------------------------------------------------------ */
/* Adapter                                                              */
/* ------------------------------------------------------------------ */

interface SystemeModule {
  id: string;
}

export class SystemeIoAdapter extends BaseDeploymentAdapter {
  platform = 'systeme-io';
  // API pure : pas de navigateur.
  capabilities = { modes: ['auto'] as DeploymentMode[], needsBrowser: false };

  /** Module (unique) portant toutes les leçons du cours. */
  private readonly modules = new WeakMap<object, SystemeModule>();

  private apiKey(ctx: DeployContext): string {
    return ctx.credentials.apiKey ?? '';
  }

  /** Appel REST authentifié (X-API-Key), JSON in/out. */
  private async api<T>(
    ctx: DeployContext,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey(ctx),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Systeme.io ${method} ${path} → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!this.apiKey(ctx)) throw new Error('Systeme.io : apiKey manquante');
        await this.withRetry(() => this.api(ctx, 'GET', '/account'), 'systeme.account');
        await this.log(ctx, 'info', 'Systeme.io : clé API validée', 4);
      },
      async () => {
        await this.log(ctx, 'info', 'Systeme.io : authentification simulée', 4);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    if (ctx.externalId) return { externalId: ctx.externalId };
    const description = buildProductDescription(ctx.course, ctx.lessons.length);
    const courseBody = buildCourseRequest(ctx.course.title, description);

    return this.guardMock(
      ctx,
      async () => {
        const course = await this.withRetry(
          () => this.api<{ id: string }>(ctx, 'POST', '/courses', courseBody),
          'systeme.createCourse',
        );
        const module = await this.withRetry(
          () =>
            this.api<{ id: string }>(
              ctx,
              'POST',
              `/courses/${course.id}/modules`,
              buildModuleRequest(ctx.course.title, 1),
            ),
          'systeme.createModule',
        );
        this.modules.set(ctx.deployment, { id: module.id });
        await this.log(ctx, 'info', `Systeme.io : cours créé (${course.id})`, 15);
        return { externalId: course.id };
      },
      async () => {
        const id = `sio_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}`;
        this.modules.set(ctx.deployment, { id: `${id}_module` });
        await this.log(ctx, 'info', `Systeme.io : cours simulé (${id})`, 15);
        return { externalId: id };
      },
    );
  }

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const moduleId = this.modules.get(ctx.deployment)?.id ?? `${ctx.externalId}_module`;
    const lessonBody = buildLessonRequest({ title: lesson.title, content: lessonContentFor(lesson) }, index);

    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () =>
            this.api(
              ctx,
              'POST',
              `/courses/${ctx.externalId}/modules/${moduleId}/lessons`,
              lessonBody,
            ),
          `systeme.uploadLesson.${index}`,
        );
        await this.log(ctx, 'info', `Systeme.io : leçon « ${lesson.title} » créée`);
      },
      async () => {
        await this.log(ctx, 'info', `Systeme.io : leçon « ${lesson.title} » créée (simulé)`);
      },
    );
  }

  /**
   * Génère le tunnel de vente complet (capture + séquence email + page de
   * vente via marketingSchema) puis tente de le pousser à l'API — sans
   * endpoint funnels/emails officiel, on stocke l'export JSON en fallback
   * (storageKeys…exportFile), téléchargeable depuis l'UI.
   */
  async setLandingPage(ctx: DeployContext): Promise<void> {
    const [capturePage, emailSequence] = await Promise.all([
      generateCapturePage(ctx.course.title),
      generateEmailSequence(ctx.course.title),
    ]);
    const salesPage = await this.resolveSalesPage(ctx);

    const funnel: FunnelExport = {
      courseTitle: ctx.course.title,
      capturePage,
      emailSequence,
      salesPage,
      generatedAt: new Date().toISOString(),
    };

    await this.guardMock(
      ctx,
      async () => {
        await this.pushFunnelIfSupported(ctx, funnel);
        await this.exportFunnel(ctx, funnel);
        await this.log(
          ctx,
          'info',
          "Systeme.io : tunnel de vente exporté (funnels/emails non exposés par l'API — import manuel requis)",
          80,
        );
      },
      async () => {
        await this.log(ctx, 'info', 'Systeme.io : tunnel de vente simulé (capture + 5 emails + page de vente)', 80);
      },
    );
  }

  /** Page de vente : réutilise marketingSchema (Course.marketing si déjà généré, sinon un nouvel appel). */
  private async resolveSalesPage(ctx: DeployContext): Promise<MarketingContent> {
    const existing = (ctx.course as { marketing?: { content?: unknown } }).marketing?.content;
    const parsed = existing ? marketingSchema.safeParse(existing) : undefined;
    if (parsed?.success) return parsed.data;

    if (isMockMode()) {
      const { mockFixtureFor } = await import('../../lib/mock-fixtures.js');
      return mockFixtureFor(marketingSchema, ctx.course.title);
    }
    return callClaudeJson<MarketingContent>({
      schema: marketingSchema,
      system:
        "Tu rédiges la page de vente (description, messages, idées de titres) d'un cours en ligne. " +
        'Réponds en JSON conforme au schéma demandé, en français.',
      user: `Cours : ${ctx.course.title}`,
    });
  }

  /**
   * Tente de pousser le tunnel via l'API si un endpoint funnels/emails existe
   * (non documenté publiquement à ce jour — appel best-effort, échec avalé).
   * Isolé pour qu'une future évolution API n'ait qu'à remplacer ce corps.
   */
  private async pushFunnelIfSupported(ctx: DeployContext, funnel: FunnelExport): Promise<void> {
    await this.api(ctx, 'POST', `/courses/${ctx.externalId}/funnel`, funnel).catch(async () => {
      await this.log(
        ctx,
        'warn',
        "Systeme.io : endpoint funnels/emails indisponible sur cette clé API — fallback export JSON.",
      );
    });
  }

  /** Stocke le tunnel généré comme export JSON téléchargeable (fallback documenté). */
  private async exportFunnel(ctx: DeployContext, funnel: FunnelExport): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const key = storageKeys.course(courseId).exportFile(FUNNEL_EXPORT_FILENAME);
    await uploadObject(key, Buffer.from(JSON.stringify(funnel, null, 2), 'utf-8'), 'application/json');
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    // Systeme.io ne soumet pas à une revue éditoriale : publication directe.
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () => this.api(ctx, 'PATCH', `/courses/${ctx.externalId}`, { status: 'published' }),
          'systeme.publish',
        );
        await this.log(ctx, 'info', 'Systeme.io : cours publié', 92);
      },
      async () => {
        await this.log(ctx, 'info', 'Systeme.io : publication simulée', 92);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const url = `https://systeme.io/courses/${ctx.externalId}`;
    return this.guardMock(
      ctx,
      async () => {
        const course = await this.withRetry(
          () => this.api<{ status?: string }>(ctx, 'GET', `/courses/${ctx.externalId}`),
          'systeme.status',
        );
        return {
          status: course.status === 'published' ? 'published' : 'running',
          externalUrl: url,
          reviewState: 'not_applicable',
        };
      },
      async () => ({ status: 'published', externalUrl: url, reviewState: 'not_applicable' }),
    );
  }
}

registerAdapter(new SystemeIoAdapter());
