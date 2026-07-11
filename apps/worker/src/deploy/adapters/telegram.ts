// Adapter Telegram (Prompt 107) — cours communautaire via l'API Bot officielle
// (api.telegram.org/bot<token>) : poste dans un CANAL privé unique (un seul
// salon, Telegram n'a pas de sous-canaux) les leçons en drip content (un
// message par leçon, calendrier de diffusion espacé — cf.
// community-transforms.buildDripSchedule), avec lien vidéo présigné inline.
//
// GATE D'ACCÈS PAYANT (point d'ancrage documenté) : Telegram ne propose aucune
// API officielle de paywall — l'accès payant à un canal privé se fait via un
// bot tiers spécialisé (ex. Telegram Premium Channels via un bot comme
// « Xelene's paywall bot », Whop, ou un bot maison qui valide un paiement
// Stripe/PayPal puis appelle createChatInviteLink avec `member_limit: 1` +
// `expire_date` pour générer un lien d'invitation à usage unique). Cet adapter
// génère ce lien d'invitation (createChatInviteLink, révocable, usage unique)
// mais NE gère PAS lui-même le paiement : `resolveInviteLink()` est le point
// d'ancrage à brancher sur le bot de paiement tiers — voir son commentaire.
//
// Auth : credentials.botToken (kind 'apikey'), credentials.channelId (canal
// cible, ex. "-1001234567890" ou "@moncours"). Mode mock (MOCK_PROVIDERS ou
// credentials absents) : aucun appel réseau réel, IDs/URL fictifs, logs « [mock] ».

import {
  presignedGetUrl,
  type DeploymentMode,
  type ILesson,
} from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { isVideoLesson } from './lesson-transforms.js';
import { buildDripSchedule, buildTelegramDripMessage, type DripScheduleItem } from './community-transforms.js';

const API = 'https://api.telegram.org';
/** Espacement par défaut entre deux déblocages de leçon (jours). */
const DEFAULT_INTERVAL_DAYS = 1;

/** Réponse générique de l'API Bot Telegram. */
interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramInviteLink {
  invite_link: string;
}

/** État par déploiement : calendrier de drip résolu + lien d'invitation généré. */
interface TelegramSession {
  schedule: DripScheduleItem[];
  inviteLink?: string;
}

export class TelegramAdapter extends BaseDeploymentAdapter {
  platform = 'telegram';
  // API pure REST : pas de navigateur ; cours communautaire = mode auto uniquement.
  capabilities = { modes: ['auto'] as DeploymentMode[], needsBrowser: false };

  private readonly sessions = new WeakMap<object, TelegramSession>();

  private botToken(ctx: DeployContext): string {
    return ctx.credentials.botToken ?? '';
  }

  private channelId(ctx: DeployContext): string {
    return ctx.credentials.channelId ?? '';
  }

  private intervalDays(ctx: DeployContext): number {
    const raw = Number(ctx.credentials.dripIntervalDays);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_DAYS;
  }

  private session(ctx: DeployContext): TelegramSession {
    const existing = this.sessions.get(ctx.deployment);
    if (existing) return existing;
    const created: TelegramSession = { schedule: buildDripSchedule(ctx.lessons, this.intervalDays(ctx)) };
    this.sessions.set(ctx.deployment, created);
    return created;
  }

  /** Appel REST de l'API Bot (JSON in/out, méthode dans le chemin). */
  private async api<T>(ctx: DeployContext, method: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = `${API}/bot${this.botToken(ctx)}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = (await res.json()) as TelegramResponse<T>;
    if (!res.ok || !json.ok) {
      throw new Error(`Telegram ${method} → ${json.description ?? res.status}`);
    }
    return json.result as T;
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!this.botToken(ctx)) throw new Error('Telegram : botToken manquant');
        if (!this.channelId(ctx)) throw new Error('Telegram : channelId manquant');
        await this.withRetry(() => this.api(ctx, 'getMe'), 'telegram.getMe');
        await this.log(ctx, 'info', 'Telegram : jeton bot validé', 4);
      },
      async () => {
        await this.log(ctx, 'info', 'Telegram : authentification simulée', 4);
      },
    );
  }

  /**
   * « Création du cours » Telegram = vérification du canal + génération du
   * lien d'invitation d'accès (voir gate de paiement documentée en tête de
   * fichier). externalId = channelId lui-même (un seul canal par cours).
   */
  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    if (ctx.externalId) return { externalId: ctx.externalId };
    const session = this.session(ctx);

    return this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () => this.api(ctx, 'getChat', { chat_id: this.channelId(ctx) }),
          'telegram.getChat',
        );
        session.inviteLink = await this.resolveInviteLink(ctx);
        await this.log(ctx, 'info', `Telegram : canal vérifié (${this.channelId(ctx)})`, 15);
        return { externalId: this.channelId(ctx) };
      },
      async () => {
        session.inviteLink = 'https://t.me/+mockInviteLink';
        await this.log(ctx, 'info', 'Telegram : canal simulé', 15);
        return { externalId: `chan_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}` };
      },
    );
  }

  /**
   * POINT D'ANCRAGE — génération du lien d'invitation payant. Sans bot de
   * paiement tiers configuré, on génère un lien d'invitation Telegram natif
   * standard (createChatInviteLink) : ce lien ne fait AUCUNE vérification de
   * paiement — c'est un lien d'accès brut. Pour un vrai paywall, brancher ici
   * l'appel au bot tiers (ex. webhook vers un bot Whop/Xelene) qui : (1) reçoit
   * le paiement, (2) appelle lui-même createChatInviteLink avec member_limit:1
   * + expire_date, (3) renvoie le lien à usage unique à l'acheteur. Cette
   * méthode reste le seul point à remplacer si/quand ce bot est intégré.
   */
  private async resolveInviteLink(ctx: DeployContext): Promise<string> {
    const link = await this.withRetry(
      () =>
        this.api<TelegramInviteLink>(ctx, 'createChatInviteLink', {
          chat_id: this.channelId(ctx),
          name: `Accès — ${ctx.course.title}`.slice(0, 32),
          creates_join_request: false,
        }),
      'telegram.createInviteLink',
    );
    return link.invite_link;
  }

  /**
   * Poste la leçon en drip content : un message HTML par leçon, dans l'ordre
   * du calendrier de diffusion (un seul canal, pas de salons par section).
   */
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const session = this.session(ctx);
    const scheduleItem = session.schedule[index] ?? { index, title: lesson.title, unlockDay: index };

    const videoUrl = isVideoLesson(lesson)
      ? await this.guardMock(
          ctx,
          () => presignedGetUrl(lesson.assets!.videoUrl!, 3600),
          () => `https://mock-cdn.sallycourse.dev/videos/${index}.mp4`,
        )
      : undefined;

    const text = buildTelegramDripMessage(lesson, scheduleItem, videoUrl);

    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () =>
            this.api(ctx, 'sendMessage', {
              chat_id: this.channelId(ctx),
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: false,
            }),
          `telegram.sendMessage.${index}`,
        );
        await this.log(
          ctx,
          'info',
          `Telegram : leçon « ${lesson.title} » postée (jour ${scheduleItem.unlockDay})`,
        );
      },
      async () => {
        await this.log(
          ctx,
          'info',
          `Telegram : leçon « ${lesson.title} » postée (simulé, jour ${scheduleItem.unlockDay})`,
        );
      },
    );
  }

  /** Message d'accueil épinglé dans le canal (landing page communautaire). */
  async setLandingPage(ctx: DeployContext): Promise<void> {
    const session = this.session(ctx);
    const text =
      `📚 <b>${escapeMinimal(ctx.course.title)}</b>\n\n` +
      `Bienvenue ! Les leçons se débloquent progressivement ` +
      `(1 tous les ${this.intervalDays(ctx)} jour(s)).` +
      (session.inviteLink ? `\n\n🔑 Lien d'accès : ${session.inviteLink}` : '');

    await this.guardMock(
      ctx,
      async () => {
        const msg = await this.withRetry(
          () =>
            this.api<{ message_id: number }>(ctx, 'sendMessage', {
              chat_id: this.channelId(ctx),
              text,
              parse_mode: 'HTML',
            }),
          'telegram.sendWelcome',
        );
        await this.withRetry(
          () =>
            this.api(ctx, 'pinChatMessage', {
              chat_id: this.channelId(ctx),
              message_id: msg.message_id,
            }),
          'telegram.pinWelcome',
        );
        await this.log(ctx, 'info', "Telegram : message d'accueil épinglé", 80);
      },
      async () => {
        await this.log(ctx, 'info', "Telegram : message d'accueil simulé", 80);
      },
    );
  }

  /** Pas de revue éditoriale côté Telegram : le canal est actif dès sa vérification. */
  async submitForReview(ctx: DeployContext): Promise<void> {
    await this.log(ctx, 'info', 'Telegram : aucune revue requise — canal actif', 92);
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const channelId = ctx.externalId ?? this.channelId(ctx);
    return this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () => this.api(ctx, 'getChat', { chat_id: channelId }),
          'telegram.status',
        );
        return {
          status: 'published' as const,
          externalUrl: `https://t.me/c/${String(channelId).replace(/^-100/, '')}`,
          reviewState: 'not_applicable',
        };
      },
      async () => ({
        status: 'published' as const,
        externalUrl: `https://t.me/c/${String(channelId).replace(/^-100/, '')}`,
        reviewState: 'not_applicable',
      }),
    );
  }
}

/** Échappe le strict nécessaire pour un texte inséré tel quel dans du HTML Telegram. */
function escapeMinimal(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

registerAdapter(new TelegramAdapter());
