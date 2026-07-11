// Adapter de déploiement Hotmart (Prompt 103) — marché lusophone/hispanophone
// (Brésil/Amérique latine). Hotmart expose deux API distinctes utilisées ici :
//   - API OAuth2 (client_credentials) : sso.hotmart.com/oauth/token, jeton
//     bearer réutilisé pour tous les appels REST.
//   - API Club Hotmart (developers.hotmart.com/club/api) : gestion du produit
//     (modules/pages) et de la page de vente associée.
//
//   authenticate    → POST /oauth/token (client_credentials)
//   createCourse    → POST /club/api/v1/modules (module racine = « cours »)
//   uploadLesson    → POST /club/api/v1/modules/{id}/pages (page = leçon,
//                     vidéo attachée par URL présignée quand disponible)
//   setLandingPage  → PUT /club/api/v1/products/{id} (description/prix)
//   submitForReview → Hotmart n'impose PAS de revue bloquante pour un produit
//                     Club déjà créé : la publication est immédiate (documenté
//                     ci-dessous, no-op réseau au-delà d'un log).
//   getStatus       → GET /club/api/v1/products/{id}
//
// MOCK (MOCK_PROVIDERS ou credentials absents) : aucun appel réseau, jeton et
// identifiants fictifs, URL simulée hotmart.com/... , logs « [mock] ».

import type { DeploymentMode, ILesson } from '../../shared.js';
import { presignedGetUrl, DEFAULT_MARKETPLACE_PRICE } from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { buildProductDescription, isVideoLesson } from './lesson-transforms.js';
import { locateLesson, mapCourseStructure, type MappedCourse } from './structure.js';

/** Plateforme (clé du registre + credentials). */
export const HOTMART_PLATFORM = 'hotmart';

const OAUTH_TOKEN_URL = 'https://api-sec-vlc.hotmart.com/security/oauth/token';
const CLUB_API_BASE = 'https://developers.hotmart.com/club/api/v1';
/** Prix par défaut (BRL, unité monétaire) si le cours n'en fournit pas (constants.ts, P113). */
const DEFAULT_PRICE_BRL = DEFAULT_MARKETPLACE_PRICE.hotmartBrl;

/* ------------------------------------------------------------------ */
/* Helpers PURS (mapping / requêtes) — testables sans réseau           */
/* ------------------------------------------------------------------ */

/** Construit le corps de la requête OAuth2 client_credentials (form-urlencoded). */
export function buildHotmartTokenRequest(clientId: string, clientSecret: string): {
  url: string;
  body: string;
} {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  return { url: OAUTH_TOKEN_URL, body: body.toString() };
}

/** En-têtes d'appel API Club Hotmart (jeton bearer). */
export function hotmartAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/** Payload de création du module racine (le « cours » côté Hotmart Club). */
export function buildHotmartModulePayload(courseTitle: string): Record<string, unknown> {
  return { name: courseTitle.trim() || 'Cours', status: 'PUBLISHED' };
}

/** Payload d'une page (leçon) rattachée à un module, vidéo optionnelle. */
export function buildHotmartPagePayload(
  lesson: ILesson,
  videoUrl?: string,
): Record<string, unknown> {
  return {
    name: lesson.title.trim() || 'Leçon',
    content: lesson.summary ?? '',
    ...(videoUrl ? { video_url: videoUrl } : {}),
  };
}

/** Payload de mise à jour produit (description + prix, page de vente). */
export function buildHotmartProductUpdatePayload(
  description: string,
  priceValue: number,
  currency = 'BRL',
): Record<string, unknown> {
  return { description, price: { value: priceValue, currency_code: currency } };
}

/** URL publique d'un produit Hotmart à partir de son identifiant. */
export function hotmartProductUrl(productId: string): string {
  return `https://hotmart.com/product/${productId}`;
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

interface HotmartConfig {
  clientId: string;
  clientSecret: string;
}

export class HotmartAdapter extends BaseDeploymentAdapter {
  platform = HOTMART_PLATFORM;
  capabilities = {
    modes: ['auto', 'manual'] as DeploymentMode[],
    needsBrowser: false,
  };

  /** Jeton OAuth2 mémoïsé par contexte (une seule authentification par run). */
  private tokenCache = new WeakMap<DeployContext, string>();
  /** Arbre mappé, mémoïsé par déploiement (recalcul idempotent). */
  private structureCache = new WeakMap<DeployContext, MappedCourse>();

  private config(ctx: DeployContext): HotmartConfig | null {
    const clientId = ctx.credentials.clientId ?? '';
    const clientSecret = ctx.credentials.clientSecret ?? '';
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  private structure(ctx: DeployContext): MappedCourse {
    const cached = this.structureCache.get(ctx);
    if (cached) return cached;
    const mapped = mapCourseStructure(ctx.course, ctx.sections, ctx.lessons);
    this.structureCache.set(ctx, mapped);
    return mapped;
  }

  /** Obtient (et mémoïse) le jeton bearer via OAuth2 client_credentials. */
  private async token(ctx: DeployContext): Promise<string> {
    const cached = this.tokenCache.get(ctx);
    if (cached) return cached;
    const cfg = this.config(ctx);
    if (!cfg) throw new Error('Hotmart : credentials manquants (clientId + clientSecret)');
    const { url, body } = buildHotmartTokenRequest(cfg.clientId, cfg.clientSecret);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Hotmart OAuth2 : HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('Hotmart OAuth2 : access_token absent de la réponse');
    this.tokenCache.set(ctx, json.access_token);
    return json.access_token;
  }

  /** Appel REST authentifié vers l'API Club Hotmart. */
  private async api<T>(
    ctx: DeployContext,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const accessToken = await this.token(ctx);
    const res = await fetch(`${CLUB_API_BASE}${path}`, {
      method,
      headers: hotmartAuthHeaders(accessToken),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Hotmart ${method} ${path} → HTTP ${res.status} ${text}`.trim());
    }
    return (await res.json()) as T;
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(() => this.token(ctx), 'hotmart.oauth');
        await this.log(ctx, 'info', 'Hotmart : jeton OAuth2 obtenu', 5);
      },
      async () => {
        await this.log(ctx, 'info', 'Hotmart : authentification simulée', 5);
      },
    );
  }

  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    if (ctx.externalId) return { externalId: ctx.externalId };
    const mapped = this.structure(ctx);
    const payload = buildHotmartModulePayload(ctx.course.title);

    return this.guardMock(
      ctx,
      async () => {
        const res = await this.withRetry(
          () => this.api<{ id?: string | number }>(ctx, 'POST', '/modules', payload),
          'hotmart.createModule',
        );
        const id = res.id;
        if (id === undefined) throw new Error('Hotmart : id de module absent de la réponse');
        await this.log(
          ctx,
          'info',
          `Hotmart : module créé (${id}) — ${mapped.sections.length} section(s)`,
          15,
        );
        return { externalId: String(id) };
      },
      async () => {
        const id = `hotmart_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}`;
        await this.log(
          ctx,
          'info',
          `Hotmart : module simulé (${id}) — ${mapped.sections.length} section(s)`,
          15,
        );
        return { externalId: id };
      },
    );
  }

  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const mapped = this.structure(ctx);
    const located = locateLesson(mapped, index);
    const sectionTitle = located?.section.title ?? 'Divers';

    await this.guardMock(
      ctx,
      async () => {
        const videoUrl = isVideoLesson(lesson)
          ? await presignedGetUrl(lesson.assets!.videoUrl!, 3600)
          : undefined;
        const payload = buildHotmartPagePayload(lesson, videoUrl);
        await this.withRetry(
          () => this.api(ctx, 'POST', `/modules/${ctx.externalId}/pages`, payload),
          'hotmart.uploadPage',
        );
        await this.log(
          ctx,
          'info',
          `Hotmart : leçon « ${lesson.title} » ajoutée (module « ${sectionTitle} »)`,
        );
      },
      async () => {
        await this.log(
          ctx,
          'info',
          `Hotmart : leçon simulée #${index} « ${lesson.title} » (module « ${sectionTitle} »)`,
        );
      },
    );
  }

  async setLandingPage(ctx: DeployContext): Promise<void> {
    const description = buildProductDescription(ctx.course, ctx.lessons.length);
    const priceValue = Number(
      (ctx.course as { priceBrl?: unknown }).priceBrl ?? DEFAULT_PRICE_BRL,
    );
    const payload = buildHotmartProductUpdatePayload(description, priceValue);

    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () => this.api(ctx, 'PUT', `/products/${ctx.externalId}`, payload),
          'hotmart.updateProduct',
        );
        await this.log(ctx, 'info', 'Hotmart : description et prix mis à jour', 80);
      },
      async () => {
        await this.log(ctx, 'info', 'Hotmart : page de vente simulée', 80);
      },
    );
  }

  async submitForReview(ctx: DeployContext): Promise<void> {
    // Hotmart n'impose pas de revue bloquante pour un produit Club existant :
    // la publication est effective dès la création/mise à jour du module — on
    // journalise sans appel réseau supplémentaire (documenté en tête de fichier).
    await this.log(
      ctx,
      'info',
      'Hotmart : pas de revue bloquante — produit déjà publié via le module Club',
      92,
    );
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    return this.guardMock(
      ctx,
      async () => {
        const res = await this.withRetry(
          () =>
            this.api<{ status?: string; id?: string | number }>(
              ctx,
              'GET',
              `/products/${ctx.externalId}`,
            ),
          'hotmart.status',
        );
        const id = res.id !== undefined ? String(res.id) : ctx.externalId ?? '';
        return {
          status: 'published',
          externalUrl: hotmartProductUrl(id),
          reviewState: 'not_applicable',
        };
      },
      async () => ({
        status: 'published',
        externalUrl: hotmartProductUrl(ctx.externalId ?? 'mock'),
        reviewState: 'not_applicable',
      }),
    );
  }
}

/** Instance prête à l'enregistrement dans le registre. */
export const hotmartAdapter = new HotmartAdapter();

// Enregistrement non destructif (ne touche pas aux autres adapters).
registerAdapter(hotmartAdapter);
