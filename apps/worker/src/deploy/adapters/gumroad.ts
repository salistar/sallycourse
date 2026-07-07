// Adapter Gumroad (Prompt 40) — vente DIRECTE de produit numérique, SANS revue.
// Gumroad expose une API REST (api.gumroad.com/v2) : on crée un produit, on lui
// attache le ZIP packagé (course-pack.zip) comme fichier téléchargeable, plus
// éventuellement les vidéos de leçons, on renseigne description + prix, puis on
// publie. Pas d'étape submitForReview réelle (statut « published » immédiat).
//
// Auth : credentials.accessToken (kind 'apikey', champ web « accessToken »).
// Mode mock (MOCK_PROVIDERS ou token absent) : aucun appel réseau, IDs/URL
// fictifs, logs « [mock] ».

import {
  presignedGetUrl,
  storageKeys,
  type DeploymentMode,
  type ILesson,
} from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { buildProductDescription, isVideoLesson } from './lesson-transforms.js';

const GUMROAD_API = 'https://api.gumroad.com/v2';
/** Nom du ZIP packagé (aligné sur le processor packaging). */
const COURSE_PACK_FILENAME = 'course-pack.zip';
/** Prix par défaut (centimes) si le cours n'en fournit pas. */
const DEFAULT_PRICE_CENTS = 4900;

/** Réponse minimale d'un produit Gumroad. */
interface GumroadProduct {
  id: string;
  short_url?: string;
  published?: boolean;
}

export class GumroadAdapter extends BaseDeploymentAdapter {
  platform = 'gumroad';
  // API pure : pas de navigateur ; vente directe → un seul mode 'auto' pertinent.
  capabilities = { modes: ['auto'] as DeploymentMode[], needsBrowser: false };

  private token(ctx: DeployContext): string {
    return ctx.credentials.accessToken ?? ctx.credentials.token ?? '';
  }

  /** Appel REST authentifié (form-urlencoded, token en query comme l'exige Gumroad). */
  private async api<T>(
    ctx: DeployContext,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const body = new URLSearchParams({ access_token: this.token(ctx), ...params });
    const url = `${GUMROAD_API}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'GET' ? undefined : body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Gumroad ${method} ${path} → HTTP ${res.status}`);
    }
    const json = (await res.json()) as { success?: boolean; message?: string } & Record<string, unknown>;
    if (json.success === false) {
      throw new Error(`Gumroad ${path} : ${json.message ?? 'échec API'}`);
    }
    return json as T;
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!this.token(ctx)) throw new Error('Gumroad : accessToken manquant');
        // Vérifie le jeton via un endpoint léger.
        await this.withRetry(() => this.api(ctx, 'GET', '/user'), 'gumroad.user');
        await this.log(ctx, 'info', 'Gumroad : jeton validé', 4);
      },
      async () => {
        await this.log(ctx, 'info', 'Gumroad : authentification simulée', 4);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    // Reprise : réutilise l'externalId déjà connu (idempotence).
    if (ctx.externalId) return { externalId: ctx.externalId };

    const description = buildProductDescription(ctx.course, ctx.lessons.length);
    return this.guardMock(
      ctx,
      async () => {
        const product = await this.withRetry(
          () =>
            this.api<{ product: GumroadProduct }>(ctx, 'POST', '/products', {
              name: ctx.course.title,
              description,
              price: String(DEFAULT_PRICE_CENTS),
            }),
          'gumroad.createProduct',
        );
        const id = product.product.id;
        await this.log(ctx, 'info', `Gumroad : produit créé (${id})`, 15);
        return { externalId: id };
      },
      async () => {
        const id = `gum_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}`;
        await this.log(ctx, 'info', `Gumroad : produit simulé (${id})`, 15);
        return { externalId: id };
      },
    );
  }

  /**
   * Attache les fichiers au produit. Pour Gumroad le contenu principal est le
   * ZIP packagé ; les vidéos de leçons sont jointes via leur URL présignée. On
   * traite chaque leçon une fois (checkpoint), en n'attachant que les vidéos —
   * les autres types sont déjà inclus dans le ZIP.
   */
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    // À la première leçon, attache le pack ZIP complet (contenu principal).
    if (index === ctx.checkpoint.lessonIndex && index === 0) {
      await this.attachCoursePack(ctx);
    }
    if (!isVideoLesson(lesson)) {
      await this.log(ctx, 'info', `Gumroad : leçon « ${lesson.title} » incluse via le pack ZIP`);
      return;
    }
    await this.guardMock(
      ctx,
      async () => {
        const videoUrl = await presignedGetUrl(lesson.assets!.videoUrl!, 3600);
        await this.withRetry(
          () =>
            this.api(ctx, 'POST', `/products/${ctx.externalId}/files`, {
              url: videoUrl,
              name: `${lesson.title}.mp4`,
            }),
          'gumroad.attachVideo',
        );
        await this.log(ctx, 'info', `Gumroad : vidéo « ${lesson.title} » attachée`);
      },
      async () => {
        await this.log(ctx, 'info', `Gumroad : vidéo « ${lesson.title} » attachée`);
      },
    );
  }

  /** Attache le ZIP course-pack.zip via son URL présignée. */
  private async attachCoursePack(ctx: DeployContext): Promise<void> {
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    const zipKey = storageKeys.course(courseId).exportFile(COURSE_PACK_FILENAME);
    await this.guardMock(
      ctx,
      async () => {
        const zipUrl = await presignedGetUrl(zipKey, 3600);
        await this.withRetry(
          () =>
            this.api(ctx, 'POST', `/products/${ctx.externalId}/files`, {
              url: zipUrl,
              name: COURSE_PACK_FILENAME,
            }),
          'gumroad.attachPack',
        );
        await this.log(ctx, 'info', 'Gumroad : pack ZIP attaché au produit');
      },
      async () => {
        await this.log(ctx, 'info', `Gumroad : pack ZIP simulé (${zipKey})`);
      },
    );
  }

  async setLandingPage(ctx: DeployContext): Promise<void> {
    // La description du produit tient lieu de landing ; rien de plus côté API.
    await this.log(ctx, 'info', 'Gumroad : description produit = page de vente', 80);
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    // Pas de revue : on publie directement le produit.
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () => this.api(ctx, 'PUT', `/products/${ctx.externalId}/publish`),
          'gumroad.publish',
        );
        await this.log(ctx, 'info', 'Gumroad : produit publié', 92);
      },
      async () => {
        await this.log(ctx, 'info', 'Gumroad : publication simulée', 92);
      },
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    return this.guardMock(
      ctx,
      async () => {
        const res = await this.withRetry(
          () => this.api<{ product: GumroadProduct }>(ctx, 'GET', `/products/${ctx.externalId}`),
          'gumroad.status',
        );
        const url = res.product.short_url;
        return {
          status: res.product.published ? 'published' : 'running',
          externalUrl: url,
          reviewState: 'not_applicable',
        };
      },
      async () => ({
        status: 'published',
        externalUrl: `https://gumroad.com/l/${ctx.externalId}`,
        reviewState: 'not_applicable',
      }),
    );
  }
}

registerAdapter(new GumroadAdapter());
