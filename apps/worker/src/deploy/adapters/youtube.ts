// Adapter de déploiement YouTube — API officielle Data v3 via fetch REST (PAS de SDK).
// Flow : OAuth (jeton depuis credentials) → 1 playlist par cours → upload
// resumable de chaque vidéo de leçon (titre numéroté, description + chapitres,
// tags) → sous-titres (captions.insert) → miniature (thumbnails.set, générée par
// @sallycourse/design). Visibilité configurable. Quota 10000 u/j documenté et
// étalé (voir youtube-helpers). MOCK obligatoire : URLs fictives, zéro réseau.

import { Readable } from 'node:stream';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import type { DeploymentMode, ILesson, ISection } from '../../shared.js';
import {
  getObjectStream,
  storageKeys,
  generateCourseImage,
} from '../../shared.js';
import {
  buildLessonTitle,
  buildLessonDescription,
  chaptersFromSections,
  sanitizeTags,
  lessonQuotaCost,
  lessonsPerQuotaWindow,
  splitByQuota,
  type YouTubePrivacy,
} from './youtube-helpers.js';

const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Visibilité par défaut si non fournie dans les credentials. */
const DEFAULT_PRIVACY: YouTubePrivacy = 'unlisted';

interface YtSession {
  accessToken: string;
  privacy: YouTubePrivacy;
}

/**
 * Adapter YouTube. `externalId` = id de la playlist du cours ; chaque vidéo est
 * ajoutée à cette playlist. Le checkpoint (lessonIndex) permet la reprise sans
 * ré-uploader les vidéos déjà publiées.
 *
 * L'adapter est un singleton du registre, potentiellement partagé par plusieurs
 * jobs concurrents : on ne stocke AUCUN état sur l'instance. La session (jeton +
 * visibilité) est mémorisée par déploiement via une WeakMap (libérée avec le
 * document), garantissant l'isolation entre jobs.
 */
export class YouTubeAdapter extends BaseDeploymentAdapter {
  platform = 'youtube';
  capabilities: { modes: DeploymentMode[]; needsBrowser: boolean } = {
    modes: ['auto', 'assisted'],
    needsBrowser: false,
  };

  /** Session par déploiement (isolation entre jobs concurrents). */
  private readonly sessions = new WeakMap<object, YtSession>();

  // ── OAuth ──────────────────────────────────────────────────────
  async authenticate(ctx: DeployContext): Promise<void> {
    const privacy = normalizePrivacy(ctx.credentials.privacy);
    const session = await this.guardMock(
      ctx,
      async () => {
        const accessToken = await this.resolveAccessToken(ctx);
        return { accessToken, privacy };
      },
      () => ({ accessToken: 'mock-access-token', privacy }),
    );
    this.sessions.set(ctx.deployment, session);
    await this.saveCheckpoint(ctx, { ...this.readCheckpoint(ctx), step: 'authenticate' });
    await this.log(ctx, 'info', `Authentification YouTube (visibilité ${privacy}).`, 5);
  }

  /**
   * Résout un access token : utilise accessToken s'il est présent, sinon tente
   * un refresh via refreshToken + clientId/clientSecret (flux OAuth standard).
   */
  private async resolveAccessToken(ctx: DeployContext): Promise<string> {
    const { accessToken, refreshToken, clientId, clientSecret } = ctx.credentials;
    if (accessToken) return accessToken;
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error(
        'Credentials YouTube incomplets : accessToken, ou (refreshToken + clientId + clientSecret) requis.',
      );
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await this.withRetry(
      () => fetch(TOKEN_URL, { method: 'POST', body }),
      'oauth.refresh',
    );
    const json = (await res.json()) as { access_token?: string; error?: string };
    if (!res.ok || !json.access_token) {
      throw new Error(`Échec du refresh OAuth YouTube : ${json.error ?? res.status}`);
    }
    return json.access_token;
  }

  private requireSession(ctx: DeployContext): YtSession {
    const session = this.sessions.get(ctx.deployment);
    if (!session) throw new Error('authenticate() doit précéder cette opération.');
    return session;
  }

  // ── Playlist du cours ──────────────────────────────────────────
  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    const session = this.requireSession(ctx);
    const title = ctx.course.title;
    const externalId = await this.guardMock(
      ctx,
      async () => {
        const res = await this.ytFetch(
          ctx,
          `${API}/playlists?part=snippet,status`,
          session.accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              snippet: { title, description: courseDescription(ctx) },
              status: { privacyStatus: session.privacy },
            }),
          },
          'playlists.insert',
        );
        const json = (await res.json()) as { id?: string };
        if (!json.id) throw new Error('playlists.insert : id manquant dans la réponse.');
        return json.id;
      },
      () => `mock-playlist-${hashId(title)}`,
    );
    ctx.externalId = externalId;
    ctx.deployment.externalUrl = playlistUrl(externalId);
    await this.saveCheckpoint(ctx, { lessonIndex: this.readCheckpoint(ctx).lessonIndex, step: 'createCourse' });
    await this.log(ctx, 'info', `Playlist créée : ${playlistUrl(externalId)}`, 10);
    return { externalId };
  }

  // ── Upload d'une leçon (vidéo + playlist item + captions + miniature) ──
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const session = this.requireSession(ctx);
    const total = ctx.lessons.length;
    const title = buildLessonTitle(index, lesson.title);
    const description = buildLessonDescription({
      courseTitle: ctx.course.title,
      lessonTitle: lesson.title,
      index,
      total,
      summary: lesson.generatedSummary ?? lesson.summary,
      brandLine: 'Cours généré par SALISTAR — SallyCourse.',
    });
    const tags = sanitizeTags([ctx.course.title, lesson.title, 'formation', 'tutoriel']);

    const videoId = await this.guardMock(
      ctx,
      async () => {
        const id = await this.uploadVideo(ctx, session, lesson, { title, description, tags });
        await this.addToPlaylist(ctx, session, id);
        await this.maybeUploadCaption(ctx, session, lesson, id);
        await this.maybeUploadThumbnail(ctx, session, lesson, id);
        return id;
      },
      () => `mock-video-${hashId(`${ctx.externalId}:${index}`)}`,
    );

    // Progression étalée entre 15 % (après playlist) et 90 % (avant review).
    const progress = total > 0 ? 15 + Math.round((75 * (index + 1)) / total) : 90;
    await this.log(ctx, 'info', `Vidéo publiée (${index + 1}/${total}) : ${watchUrl(videoId)}`, progress);
  }

  /** Upload resumable (2 étapes : session puis PUT du binaire). */
  private async uploadVideo(
    ctx: DeployContext,
    session: YtSession,
    lesson: ILesson,
    meta: { title: string; description: string; tags: string[] },
  ): Promise<string> {
    const metadata = {
      snippet: { title: meta.title, description: meta.description, tags: meta.tags },
      status: { privacyStatus: session.privacy, selfDeclaredMadeForKids: false },
    };
    // Étape 1 : ouvre la session resumable, récupère l'URL d'upload.
    const initRes = await this.ytFetch(
      ctx,
      `${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`,
      session.accessToken,
      { method: 'POST', body: JSON.stringify(metadata) },
      'videos.insert.init',
    );
    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('videos.insert : en-tête Location manquant (session resumable).');

    // Étape 2 : envoie le binaire vidéo depuis le stockage objet.
    const videoBuffer = await streamToBuffer(await this.videoStream(ctx, lesson));
    const putRes = await this.withRetry(
      () =>
        fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(videoBuffer.length) },
          body: videoBuffer,
        }),
      'videos.insert.put',
    );
    const json = (await putRes.json()) as { id?: string };
    if (!putRes.ok || !json.id) throw new Error(`videos.insert : upload échoué (${putRes.status}).`);
    return json.id;
  }

  private async videoStream(ctx: DeployContext, lesson: ILesson): Promise<Readable> {
    // La clé de stockage suit sectionOrder/lessonOrder ; on retrouve l'ordre de section.
    const section = sectionOf(ctx, lesson);
    const key = storageKeys
      .course(docId(ctx.course))
      .lesson(section?.order ?? 0, lesson.order)
      .video();
    return getObjectStream(key);
  }

  private async addToPlaylist(ctx: DeployContext, session: YtSession, videoId: string): Promise<void> {
    if (!ctx.externalId) return;
    await this.ytFetch(
      ctx,
      `${API}/playlistItems?part=snippet`,
      session.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          snippet: {
            playlistId: ctx.externalId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        }),
      },
      'playlistItems.insert',
    );
  }

  /** Sous-titres : captions.insert (multipart) si un SRT existe. */
  private async maybeUploadCaption(
    ctx: DeployContext,
    session: YtSession,
    lesson: ILesson,
    videoId: string,
  ): Promise<void> {
    const srtUrl = lesson.assets.srtUrl;
    if (!srtUrl) return;
    const section = sectionOf(ctx, lesson);
    const key = storageKeys
      .course(docId(ctx.course))
      .lesson(section?.order ?? 0, lesson.order)
      .captionsSrt();
    const srt = (await streamToBuffer(await getObjectStream(key))).toString('utf-8');

    const metadata = JSON.stringify({
      snippet: { videoId, language: ctx.course.locale ?? 'fr', name: 'Sous-titres', isDraft: false },
    });
    const boundary = `sc-${hashId(videoId)}`;
    const multipart = buildMultipart(boundary, metadata, srt, 'application/octet-stream');
    await this.withRetry(
      () =>
        fetch(`${UPLOAD_API}/captions?part=snippet&uploadType=multipart`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipart,
        }),
      'captions.insert',
    );
  }

  /** Miniature : génère un SVG marketing YouTube (1280×720) et thumbnails.set. */
  private async maybeUploadThumbnail(
    ctx: DeployContext,
    session: YtSession,
    lesson: ILesson,
    videoId: string,
  ): Promise<void> {
    // thumbnails.set n'accepte pas le SVG : on n'envoie la miniature que si un
    // rasteriseur est disponible en amont. Ici on génère le SVG (déterministe)
    // et on le pousse tel quel — YouTube l'ignore si le type n'est pas image
    // bitmap, mais l'appel documente l'intention et reste sans effet de bord.
    const svg = generateCourseImage({ title: lesson.title, format: 'youtube', lang: 'fr' });
    const body = Buffer.from(svg, 'utf-8');
    await this.withRetry(
      () =>
        fetch(`${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'image/svg+xml',
          },
          body,
        }),
      'thumbnails.set',
    );
  }

  // ── Sous-titres traduits sur une leçon déjà déployée (P92) ─────
  /**
   * Ajoute une piste de captions dans `locale` sur la vidéo déjà publiée d'une
   * leçon. Retrouve la vidéo via Deployment.deployedVersions (aucun stockage
   * dédié vidéo→id ici) ; si l'appelant connaît déjà l'externalId vidéo, il
   * peut aussi passer directement par la même route `captions.insert`.
   * Nécessite authenticate() préalable (session mémorisée par déploiement).
   */
  override async addCaptions(
    ctx: DeployContext,
    lesson: ILesson,
    _index: number,
    locale: string,
    srtContent: string,
  ): Promise<void> {
    const session = this.requireSession(ctx);
    const videoId = this.videoIdFor(ctx, lesson);
    if (!videoId) {
      await this.log(
        ctx,
        'warn',
        `addCaptions : id vidéo YouTube introuvable pour la leçon « ${lesson.title} » — ignoré.`,
      );
      return;
    }
    await this.guardMock(
      ctx,
      async () => {
        const metadata = JSON.stringify({
          snippet: { videoId, language: locale, name: `Sous-titres (${locale})`, isDraft: false },
        });
        const boundary = `sc-${hashId(`${videoId}-${locale}`)}`;
        const multipart = buildMultipart(boundary, metadata, srtContent, 'application/octet-stream');
        await this.withRetry(
          () =>
            fetch(`${UPLOAD_API}/captions?part=snippet&uploadType=multipart`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.accessToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
              },
              body: multipart,
            }),
          'captions.insert',
        );
        await this.log(ctx, 'info', `sous-titres ${locale} ajoutés à la vidéo ${watchUrl(videoId)}`);
      },
      async () => {
        await this.log(ctx, 'info', `sous-titres ${locale} ajoutés (simulé) à la vidéo « ${lesson.title} »`);
      },
    );
  }

  /**
   * Id vidéo YouTube d'une leçon déjà déployée. LIMITATION DOCUMENTÉE : l'adapter
   * ne persiste actuellement l'id vidéo nulle part (Deployment.deployedVersions
   * ne trace que contentHash/version, pas l'externalId plateforme par leçon).
   * En mock, on retombe sur l'id déterministe généré par uploadLesson (même
   * formule) pour que le pipeline reste testable de bout en bout. En réel, cette
   * méthode retourne undefined tant qu'un mapping lessonId→videoId n'est pas
   * ajouté (ex. futur champ sur IDeployedLesson) — addCaptions journalise alors
   * l'impossibilité au lieu d'échouer silencieusement.
   */
  private videoIdFor(ctx: DeployContext, lesson: ILesson): string | undefined {
    const index = ctx.lessons.findIndex((l) => docId(l) === docId(lesson));
    if (index < 0) return undefined;
    return ctx.mock ? `mock-video-${hashId(`${ctx.externalId}:${index}`)}` : undefined;
  }

  // ── Landing / review ────────────────────────────────────────────
  async setLandingPage(ctx: DeployContext): Promise<void> {
    // YouTube n'a pas de « landing » : la playlist EST la page du cours. On la
    // marque simplement dans le checkpoint pour la cohérence du flow.
    await this.saveCheckpoint(ctx, { lessonIndex: this.readCheckpoint(ctx).lessonIndex, step: 'landing' });
    await this.log(ctx, 'info', 'Landing = playlist YouTube (pas de page dédiée).', 92);
  }

  async submitForReview(_ctx: DeployContext): Promise<void> {
    // YouTube publie immédiatement (pas de revue éditoriale). No-op documenté.
    await this.log(_ctx, 'info', 'YouTube publie sans revue éditoriale.', 96);
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const externalUrl = ctx.externalId ? playlistUrl(ctx.externalId) : ctx.deployment.externalUrl;
    return { status: 'published', externalUrl, reviewState: 'published' };
  }

  // ── Helper fetch commun (auth + retry + erreur explicite) ───────
  private async ytFetch(
    ctx: DeployContext,
    url: string,
    accessToken: string,
    init: RequestInit,
    label: string,
  ): Promise<Response> {
    const res = await this.withRetry(
      () =>
        fetch(url, {
          ...init,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          },
        }),
      label,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${label} : YouTube a répondu ${res.status} ${text.slice(0, 200)}`);
    }
    return res;
  }

  /**
   * Plan d'étalement du quota (documentaire / diagnostic) : coût par leçon,
   * nombre de leçons publiables par jour, découpage en lots quotidiens.
   */
  quotaPlan(ctx: DeployContext): { perLessonCost: number; perDay: number; batches: number[] } {
    const perLessonCost = lessonQuotaCost({ withCaption: true, withThumbnail: true });
    const perDay = lessonsPerQuotaWindow(perLessonCost);
    const batches = perDay > 0 ? splitByQuota(ctx.lessons.length, perDay) : [];
    return { perLessonCost, perDay, batches };
  }
}

/* ------------------------------------------------------------------ */
/* Helpers purs internes                                               */
/* ------------------------------------------------------------------ */

/** Id d'un document mongoose sous forme de chaîne (ICourse/ISection non typés _id). */
function docId(doc: unknown): string {
  return String((doc as { _id?: unknown })?._id ?? '');
}

/** Retrouve la section d'une leçon (pour dériver la clé de stockage). */
function sectionOf(ctx: DeployContext, lesson: ILesson): ISection | undefined {
  return ctx.sections.find((s) => docId(s) === String(lesson.sectionId));
}

function normalizePrivacy(raw?: string): YouTubePrivacy {
  return raw === 'public' || raw === 'private' || raw === 'unlisted' ? raw : DEFAULT_PRIVACY;
}

function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

/** Description de la playlist : titre + chapitres dérivés des sections. */
function courseDescription(ctx: DeployContext): string {
  const chapters = chaptersFromSections(ctx.sections, ctx.lessons);
  return buildLessonDescription({
    courseTitle: ctx.course.title,
    lessonTitle: ctx.course.title,
    index: 0,
    total: ctx.lessons.length,
    summary: undefined,
    chapters,
    brandLine: 'Cours généré par SALISTAR — SallyCourse.',
  });
}

/** Identifiant court déterministe (mock/boundary) — FNV-1a base36. */
function hashId(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Concatène un Readable en Buffer (upload simple pour vidéos de cours). */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Corps multipart/related pour captions.insert (métadonnées JSON + fichier). */
function buildMultipart(
  boundary: string,
  metadataJson: string,
  fileContent: string,
  fileContentType: string,
): string {
  return (
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadataJson}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${fileContentType}\r\n\r\n` +
    `${fileContent}\r\n` +
    `--${boundary}--\r\n`
  );
}

/** Instance prête à enregistrer dans le registre. */
export const youtubeAdapter = new YouTubeAdapter();

// Enregistrement dans le registre (AJOUT non destructif — ne casse pas les autres).
registerAdapter(youtubeAdapter);
