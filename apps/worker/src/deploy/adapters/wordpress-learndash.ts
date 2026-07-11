// Adapter WordPress / LearnDash & Tutor LMS (Prompt 108) — publie le cours
// directement sur le site WordPress auto-hébergé du client, via l'API REST
// officielle (wp-json/wp/v2) authentifiée par Application Password (Basic Auth
// user:app-password — mécanisme natif WordPress ≥ 5.6, aucun plugin requis
// côté auth) + les custom post types exposés par le plugin LMS installé :
//
//   LearnDash : sfwd-courses (cours), sfwd-lessons (leçons), sfwd-quiz (quiz),
//               association hiérarchique via le champ meta `course_id`
//               (leçon → cours) exposé par LearnDash REST (learndash/v2 activé
//               par le plugin, ou meta `_sfwd-lessons_course` en fallback REST
//               natif wp/v2 selon la version).
//   Tutor LMS  : courses (cours), lesson (post type des leçons Tutor), même
//               principe d'association via un champ meta dédié
//               (`_tutor_course_id_for_lesson`).
//
// Les deux plugins réutilisent EXACTEMENT le même flow (authenticate →
// createCourse → uploadLesson → setLandingPage → submitForReview → getStatus) ;
// seul le mapping post-type/meta change → isolé dans `LMS_PLUGIN_CONFIG`.
// Paramètre `lmsPlugin` lu depuis credentials.lmsPlugin ('learndash' | 'tutor'),
// défaut 'learndash'.
//
// Média : la vidéo de leçon (assets.videoUrl, clé S3) est uploadée en pièce
// jointe WordPress (wp-json/wp/v2/media) puis référencée (URL) dans le corps
// de la leçon ; l'article (assets.articleMd) est converti en HTML
// (markdownToHtml, réutilisé de media/pack.ts) et injecté tel quel.
//
// Auth : credentials.siteUrl (racine WordPress, sans /wp-json) +
// credentials.username + credentials.appPassword (Application Password créée
// depuis le profil utilisateur WordPress — jamais le mot de passe du compte).
// Mode mock (MOCK_PROVIDERS ou credentials incomplets) : aucun appel réseau,
// IDs/URL fictifs, logs « [mock] ».

import { getObjectStream, presignedGetUrl, type DeploymentMode, type ILesson } from '../../shared.js';
import { markdownToHtml } from '../../media/pack.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { isVideoLesson } from './lesson-transforms.js';

export const WORDPRESS_PLATFORM = 'wordpress-learndash';

/** Plugin LMS ciblé — même fichier, mapping post-type/meta distinct. */
export type LmsPlugin = 'learndash' | 'tutor';

/* ------------------------------------------------------------------ */
/* Mapping post-type / meta par plugin — PUR, testable hors-ligne     */
/* ------------------------------------------------------------------ */

/** Configuration REST d'un plugin LMS (post types + champ meta d'association). */
export interface LmsPluginConfig {
  plugin: LmsPlugin;
  /** Post type du cours (wp-json/wp/v2/{coursePostType}). */
  coursePostType: string;
  /** Post type de la leçon. */
  lessonPostType: string;
  /** Champ meta portant l'id du cours parent sur une leçon. */
  courseMetaKey: string;
  /** Champ meta portant l'ordre/position de la leçon (menu_order natif sinon). */
  orderMetaKey?: string;
}

const LMS_PLUGIN_CONFIG: Record<LmsPlugin, LmsPluginConfig> = {
  learndash: {
    plugin: 'learndash',
    coursePostType: 'sfwd-courses',
    lessonPostType: 'sfwd-lessons',
    courseMetaKey: 'course_id',
  },
  tutor: {
    plugin: 'tutor',
    coursePostType: 'courses',
    lessonPostType: 'lesson',
    courseMetaKey: '_tutor_course_id_for_lesson',
  },
};

/** Résout la config plugin depuis credentials.lmsPlugin (défaut LearnDash). */
export function resolveLmsPluginConfig(lmsPlugin?: string): LmsPluginConfig {
  const key = lmsPlugin === 'tutor' ? 'tutor' : 'learndash';
  return LMS_PLUGIN_CONFIG[key];
}

/* ------------------------------------------------------------------ */
/* Construction des requêtes wp-json — PURES, testables hors-ligne    */
/* ------------------------------------------------------------------ */

/** Racine de l'API REST WordPress à partir de l'URL du site (sans slash final). */
export function wpApiRoot(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/wp-json/wp/v2`;
}

/** En-tête Basic Auth Application Password (base64 user:appPassword). */
export function wpAuthHeader(username: string, appPassword: string): string {
  const token = Buffer.from(`${username}:${appPassword}`, 'utf-8').toString('base64');
  return `Basic ${token}`;
}

/** Corps de la requête de création du post cours (status draft → publish au submitForReview). */
export function buildCoursePostPayload(
  title: string,
  contentHtml: string,
): { title: string; content: string; status: 'draft' } {
  return { title, content: contentHtml, status: 'draft' };
}

/** Contenu HTML d'une leçon : vidéo intégrée (si présente) + article converti. */
export function buildLessonContentHtml(
  lesson: ILesson,
  articleHtml: string | null,
  videoAttachmentUrl: string | null,
): string {
  const parts: string[] = [];
  if (videoAttachmentUrl) {
    parts.push(
      `<!-- wp:video --><figure class="wp-block-video"><video controls src="${videoAttachmentUrl}"></video></figure><!-- /wp:video -->`,
    );
  }
  if (articleHtml) {
    parts.push(articleHtml);
  } else if (lesson.summary) {
    parts.push(`<p>${lesson.summary}</p>`);
  }
  return parts.join('\n\n') || `<p>${lesson.title}</p>`;
}

/**
 * Corps de la requête de création du post leçon, avec association hiérarchique
 * au cours via le champ meta du plugin (LearnDash ou Tutor) + position (menu_order).
 */
export function buildLessonPostPayload(
  config: LmsPluginConfig,
  lesson: { title: string },
  contentHtml: string,
  courseExternalId: string,
  index: number,
): {
  title: string;
  content: string;
  status: 'publish';
  menu_order: number;
  meta: Record<string, string>;
} {
  return {
    title: lesson.title,
    content: contentHtml,
    status: 'publish',
    menu_order: index + 1,
    meta: { [config.courseMetaKey]: courseExternalId },
  };
}

/** Corps de mise à jour de la page cours (landing = contenu du post cours). */
export function buildLandingPagePayload(descriptionHtml: string): { content: string } {
  return { content: descriptionHtml };
}

/** URL publique du cours (vue front, slug WordPress standard). */
export function wpCourseUrl(siteUrl: string, coursePostType: string, externalId: string): string {
  // WordPress expose systématiquement ?p={id}&post_type={cpt} comme URL canonique
  // stable indépendamment des permaliens configurés côté client.
  return `${siteUrl.replace(/\/+$/, '')}/?p=${externalId}&post_type=${coursePostType}`;
}

/** Description HTML du cours pour la landing (fallback si aucune description marketing). */
export function buildCourseDescriptionHtml(courseTitle: string, lessonCount: number): string {
  return (
    `<p><strong>${courseTitle}</strong></p>` +
    `<p>Cours complet — ${lessonCount} leçon(s) : vidéos, articles, TP et quiz.</p>`
  );
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

interface WpConfig {
  siteUrl: string;
  authHeader: string;
  pluginConfig: LmsPluginConfig;
}

export class WordPressLearnDashAdapter extends BaseDeploymentAdapter {
  platform = WORDPRESS_PLATFORM;
  capabilities = { modes: ['auto', 'assisted'] as DeploymentMode[], needsBrowser: false };

  /** Extrait/valide la config WordPress depuis les credentials (null si incomplet). */
  private config(ctx: DeployContext): WpConfig | null {
    const siteUrl = ctx.credentials.siteUrl ?? ctx.credentials.url ?? '';
    const username = ctx.credentials.username ?? '';
    const appPassword = ctx.credentials.appPassword ?? '';
    if (!siteUrl || !username || !appPassword) return null;
    return {
      siteUrl,
      authHeader: wpAuthHeader(username, appPassword),
      pluginConfig: resolveLmsPluginConfig(ctx.credentials.lmsPlugin),
    };
  }

  /** Appel REST WordPress authentifié (Application Password), JSON in/out. */
  private async api<T>(
    cfg: WpConfig,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${wpApiRoot(cfg.siteUrl)}${path}`;
    // Garde SSRF (P116) : siteUrl vient des credentials utilisateur — jamais
    // de fetch vers une IP privée/réservée (réseau interne, métadonnées cloud).
    await this.assertHostAllowed(url);
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: cfg.authHeader,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`WordPress ${method} ${path} → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  /** Upload d'un média (vidéo) vers wp-json/wp/v2/media (multipart brut). */
  private async uploadMedia(cfg: WpConfig, filename: string, body: Buffer, mime: string): Promise<string> {
    const mediaUrl = `${wpApiRoot(cfg.siteUrl)}/media`;
    // Garde SSRF (P116) : même raison que `api()` ci-dessus.
    await this.assertHostAllowed(mediaUrl);
    const res = await fetch(mediaUrl, {
      method: 'POST',
      headers: {
        Authorization: cfg.authHeader,
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`WordPress media upload → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const media = (await res.json()) as { source_url?: string };
    if (!media.source_url) throw new Error('WordPress : source_url absente de la réponse média');
    return media.source_url;
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    const cfg = this.config(ctx);
    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials WordPress manquants (siteUrl + username + appPassword)');
        // Valide les identifiants via un endpoint léger (utilisateur courant).
        await this.withRetry(() => this.api(cfg, 'GET', '/users/me'), 'wp.users.me');
        await this.log(ctx, 'info', `WordPress (${cfg.pluginConfig.plugin}) : identifiants validés`, 4);
      },
      async () => {
        const plugin = resolveLmsPluginConfig(ctx.credentials.lmsPlugin).plugin;
        await this.log(ctx, 'info', `WordPress (${plugin}) : authentification simulée`, 4);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    if (ctx.externalId) return { externalId: ctx.externalId };
    const cfg = this.config(ctx);
    const description = buildCourseDescriptionHtml(ctx.course.title, ctx.lessons.length);
    const payload = buildCoursePostPayload(ctx.course.title, description);

    return this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials WordPress manquants');
        const post = await this.withRetry(
          () => this.api<{ id: number }>(cfg, 'POST', `/${cfg.pluginConfig.coursePostType}`, payload),
          'wp.createCourse',
        );
        await this.log(ctx, 'info', `WordPress : cours créé (${cfg.pluginConfig.plugin}, #${post.id})`, 15);
        return { externalId: String(post.id) };
      },
      async () => {
        const plugin = resolveLmsPluginConfig(ctx.credentials.lmsPlugin).plugin;
        const id = `wp_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}`;
        await this.log(ctx, 'info', `WordPress : cours simulé (${plugin}, ${id})`, 15);
        return { externalId: id };
      },
    );
  }

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const cfg = this.config(ctx);

    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials WordPress manquants');

        let videoUrl: string | null = null;
        if (isVideoLesson(lesson)) {
          const signedUrl = await presignedGetUrl(lesson.assets!.videoUrl!, 3600);
          const videoRes = await fetch(signedUrl);
          const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
          videoUrl = await this.withRetry(
            () => this.uploadMedia(cfg, `${lesson.title}.mp4`, videoBuffer, 'video/mp4'),
            `wp.uploadMedia.${index}`,
          );
        }

        const articleHtml = await this.fetchArticleHtml(lesson);
        const contentHtml = buildLessonContentHtml(lesson, articleHtml, videoUrl);
        const payload = buildLessonPostPayload(
          cfg.pluginConfig,
          { title: lesson.title },
          contentHtml,
          ctx.externalId!,
          index,
        );

        await this.withRetry(
          () => this.api(cfg, 'POST', `/${cfg.pluginConfig.lessonPostType}`, payload),
          `wp.uploadLesson.${index}`,
        );
        await this.log(ctx, 'info', `WordPress : leçon « ${lesson.title} » créée`);
      },
      async () => {
        await this.log(ctx, 'info', `WordPress : leçon « ${lesson.title} » créée (simulé)`);
      },
    );
  }

  /** Télécharge l'article Markdown depuis le stockage et le convertit en HTML (null si absent). */
  private async fetchArticleHtml(lesson: ILesson): Promise<string | null> {
    const articleKey = lesson.assets?.articleMd;
    if (!articleKey) return null;
    const stream = await getObjectStream(articleKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const markdown = Buffer.concat(chunks).toString('utf-8');
    return markdownToHtml(markdown);
  }

  async setLandingPage(ctx: DeployContext): Promise<void> {
    const cfg = this.config(ctx);
    const description = buildCourseDescriptionHtml(ctx.course.title, ctx.lessons.length);
    const payload = buildLandingPagePayload(description);

    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials WordPress manquants');
        await this.withRetry(
          () => this.api(cfg, 'PATCH', `/${cfg.pluginConfig.coursePostType}/${ctx.externalId}`, payload),
          'wp.setLandingPage',
        );
        await this.log(ctx, 'info', 'WordPress : page de présentation renseignée', 80);
      },
      async () => {
        await this.log(ctx, 'info', 'WordPress : page de présentation renseignée (simulé)', 80);
      },
    );
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    const cfg = this.config(ctx);
    // Pas de revue éditoriale WordPress : publier = passer le post cours en 'publish'.
    await this.guardMock(
      ctx,
      async () => {
        if (!cfg) throw new Error('credentials WordPress manquants');
        await this.withRetry(
          () =>
            this.api(cfg, 'PATCH', `/${cfg.pluginConfig.coursePostType}/${ctx.externalId}`, {
              status: 'publish',
            }),
          'wp.publish',
        );
        await this.log(ctx, 'info', 'WordPress : cours publié', 92);
      },
      async () => {
        await this.log(ctx, 'info', 'WordPress : publication simulée', 92);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const cfg = this.config(ctx);
    return this.guardMock(
      ctx,
      async (): Promise<DeployStatus> => {
        if (!cfg) throw new Error('credentials WordPress manquants');
        const post = await this.withRetry(
          () =>
            this.api<{ status?: string; link?: string }>(
              cfg,
              'GET',
              `/${cfg.pluginConfig.coursePostType}/${ctx.externalId}`,
            ),
          'wp.status',
        );
        const url = post.link ?? wpCourseUrl(cfg.siteUrl, cfg.pluginConfig.coursePostType, ctx.externalId ?? '');
        return {
          status: post.status === 'publish' ? 'published' : 'running',
          externalUrl: url,
          reviewState: 'not_applicable',
        };
      },
      async (): Promise<DeployStatus> => {
        const plugin = resolveLmsPluginConfig(ctx.credentials.lmsPlugin).plugin;
        const cpt = LMS_PLUGIN_CONFIG[plugin].coursePostType;
        return {
          status: 'published',
          externalUrl: wpCourseUrl('https://client-site.example', cpt, ctx.externalId ?? '0'),
          reviewState: 'not_applicable',
        };
      },
    );
  }
}

registerAdapter(new WordPressLearnDashAdapter());
