// Adapter Discord (Prompt 107) — cours communautaire via l'API REST officielle
// (discord.com/api) : un salon texte par SECTION du cours (channels.create sur
// le serveur/guild cible), puis un message par LEÇON posté en drip content
// (calendrier de diffusion espacé, cf. community-transforms.buildDripSchedule).
// Chaque message embarque un embed Discord (titre, résumé, durée, lien vidéo
// présigné). La landing page = message d'accueil épinglé dans un salon
// #annonces ; pas de revue éditoriale (submitForReview = publication directe,
// Discord n'a pas de notion de modération de contenu de cours).
//
// Auth : credentials.botToken (kind 'apikey'), credentials.guildId (serveur
// cible). Mode mock (MOCK_PROVIDERS ou credentials absents) : aucun appel
// réseau réel, IDs/URL fictifs, logs « [mock] ».

import {
  presignedGetUrl,
  type DeploymentMode,
  type ILesson,
  type ISection,
} from '../../shared.js';
import { BaseDeploymentAdapter } from '../base-adapter.js';
import { registerAdapter } from '../registry.js';
import type { DeployContext, DeployStatus } from '../types.js';
import { isVideoLesson } from './lesson-transforms.js';
import {
  buildChannelName,
  buildDiscordDripMessage,
  buildDripSchedule,
  type DripScheduleItem,
} from './community-transforms.js';

const API = 'https://discord.com/api/v10';
/** Espacement par défaut entre deux déblocages de leçon (jours). */
const DEFAULT_INTERVAL_DAYS = 1;

interface DiscordChannel {
  id: string;
}

/** État par déploiement : salon par section + calendrier de drip résolu. */
interface DiscordSession {
  /** Salon Discord créé pour chaque section, indexé par sectionId (string). */
  channelBySection: Map<string, string>;
  /** Salon #annonces (landing / message d'accueil). */
  announceChannelId: string;
  schedule: DripScheduleItem[];
}

export class DiscordAdapter extends BaseDeploymentAdapter {
  platform = 'discord';
  // API pure REST : pas de navigateur ; cours communautaire = mode auto uniquement.
  capabilities = { modes: ['auto'] as DeploymentMode[], needsBrowser: false };

  /** Session par déploiement (isolation entre jobs concurrents). */
  private readonly sessions = new WeakMap<object, DiscordSession>();

  private botToken(ctx: DeployContext): string {
    return ctx.credentials.botToken ?? '';
  }

  private guildId(ctx: DeployContext): string {
    return ctx.credentials.guildId ?? '';
  }

  /** Espacement du drip (jours), configurable via credentials.dripIntervalDays. */
  private intervalDays(ctx: DeployContext): number {
    const raw = Number(ctx.credentials.dripIntervalDays);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_DAYS;
  }

  /** Appel REST authentifié (Bot token), JSON in/out. */
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
        Authorization: `Bot ${this.botToken(ctx)}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Discord ${method} ${path} → HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private session(ctx: DeployContext): DiscordSession {
    const existing = this.sessions.get(ctx.deployment);
    if (existing) return existing;
    const created: DiscordSession = {
      channelBySection: new Map(),
      announceChannelId: '',
      schedule: buildDripSchedule(ctx.lessons, this.intervalDays(ctx)),
    };
    this.sessions.set(ctx.deployment, created);
    return created;
  }

  async authenticate(ctx: DeployContext): Promise<void> {
    await this.guardMock(
      ctx,
      async () => {
        if (!this.botToken(ctx)) throw new Error('Discord : botToken manquant');
        if (!this.guildId(ctx)) throw new Error('Discord : guildId manquant');
        // Vérifie le jeton via un endpoint léger (identité du bot).
        await this.withRetry(() => this.api(ctx, 'GET', '/users/@me'), 'discord.me');
        await this.log(ctx, 'info', 'Discord : jeton bot validé', 4);
      },
      async () => {
        await this.log(ctx, 'info', 'Discord : authentification simulée', 4);
      },
    );
  }

  /**
   * « Création du cours » Discord = création du salon #annonces (landing) sur
   * le serveur. externalId = id du serveur (guild), les salons de section sont
   * créés paresseusement à la première leçon de chaque section (uploadLesson).
   */
  async createCourse(ctx: DeployContext): Promise<{ externalId: string }> {
    if (ctx.externalId) return { externalId: ctx.externalId };
    const session = this.session(ctx);

    return this.guardMock(
      ctx,
      async () => {
        const channel = await this.withRetry(
          () =>
            this.api<DiscordChannel>(ctx, 'POST', `/guilds/${this.guildId(ctx)}/channels`, {
              name: 'annonces',
              type: 0, // GUILD_TEXT
              topic: `Annonces du cours « ${ctx.course.title} »`,
            }),
          'discord.createAnnounceChannel',
        );
        session.announceChannelId = channel.id;
        await this.log(ctx, 'info', `Discord : serveur configuré (${this.guildId(ctx)})`, 15);
        return { externalId: this.guildId(ctx) };
      },
      async () => {
        session.announceChannelId = 'chan_mock_annonces';
        await this.log(ctx, 'info', 'Discord : serveur simulé', 15);
        return { externalId: `guild_mock_${String((ctx.course as { _id?: unknown })._id ?? 'course')}` };
      },
    );
  }

  /** Résout (ou crée) le salon Discord de la section portant la leçon. */
  private async resolveChannelForSection(
    ctx: DeployContext,
    section: ISection | undefined,
    fallbackTitle: string,
  ): Promise<string> {
    const session = this.session(ctx);
    const sectionKey = section ? String((section as unknown as { _id?: unknown })._id ?? section.title) : fallbackTitle;
    const existing = session.channelBySection.get(sectionKey);
    if (existing) return existing;

    const name = section ? buildChannelName(section) : buildChannelName({ title: fallbackTitle, order: 0 });
    const channelId = await this.guardMock(
      ctx,
      async () => {
        const channel = await this.withRetry(
          () =>
            this.api<DiscordChannel>(ctx, 'POST', `/guilds/${this.guildId(ctx)}/channels`, {
              name,
              type: 0,
              topic: section?.title ?? fallbackTitle,
            }),
          `discord.createChannel.${sectionKey}`,
        );
        await this.log(ctx, 'info', `Discord : salon « ${name} » créé`);
        return channel.id;
      },
      async () => {
        await this.log(ctx, 'info', `Discord : salon « ${name} » simulé`);
        return `chan_mock_${sectionKey}`;
      },
    );
    session.channelBySection.set(sectionKey, channelId);
    return channelId;
  }

  /**
   * Poste la leçon en drip content : un message (texte + embed) dans le salon
   * de sa section, avec mention du jour de déblocage (calendrier construit une
   * fois pour tout le déploiement, cf. buildDripSchedule).
   */
  async uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    const session = this.session(ctx);
    const scheduleItem = session.schedule[index] ?? { index, title: lesson.title, unlockDay: index };
    const section = ctx.sections.find(
      (s) => String((s as unknown as { _id?: unknown })._id) === String(lesson.sectionId),
    );
    const channelId = await this.resolveChannelForSection(ctx, section, `section-${index}`);

    const videoUrl = isVideoLesson(lesson)
      ? await this.guardMock(
          ctx,
          () => presignedGetUrl(lesson.assets!.videoUrl!, 3600),
          () => `https://mock-cdn.sallycourse.dev/videos/${index}.mp4`,
        )
      : undefined;

    const message = buildDiscordDripMessage(lesson, scheduleItem, videoUrl);

    await this.guardMock(
      ctx,
      async () => {
        await this.withRetry(
          () => this.api(ctx, 'POST', `/channels/${channelId}/messages`, message),
          `discord.postMessage.${index}`,
        );
        await this.log(
          ctx,
          'info',
          `Discord : leçon « ${lesson.title} » postée (jour ${scheduleItem.unlockDay})`,
        );
      },
      async () => {
        await this.log(
          ctx,
          'info',
          `Discord : leçon « ${lesson.title} » postée (simulé, jour ${scheduleItem.unlockDay})`,
        );
      },
    );
  }

  /** Message d'accueil épinglé dans #annonces (landing page communautaire). */
  async setLandingPage(ctx: DeployContext): Promise<void> {
    const session = this.session(ctx);
    const content =
      `📚 **${ctx.course.title}**\n\n` +
      `Bienvenue dans le serveur du cours ! Les leçons se débloquent progressivement ` +
      `(1 tous les ${this.intervalDays(ctx)} jour(s)) dans les salons dédiés à chaque section.`;

    await this.guardMock(
      ctx,
      async () => {
        const msg = await this.withRetry(
          () =>
            this.api<{ id: string }>(ctx, 'POST', `/channels/${session.announceChannelId}/messages`, {
              content,
            }),
          'discord.postWelcome',
        );
        await this.withRetry(
          () => this.api(ctx, 'PATCH', `/channels/${session.announceChannelId}/pins/${msg.id}`),
          'discord.pinWelcome',
        );
        await this.log(ctx, 'info', "Discord : message d'accueil épinglé", 80);
      },
      async () => {
        await this.log(ctx, 'info', "Discord : message d'accueil simulé", 80);
      },
    );
  }

  /** Pas de revue éditoriale côté Discord : le serveur est déjà « publié » dès sa création. */
  async submitForReview(ctx: DeployContext): Promise<void> {
    await this.log(ctx, 'info', 'Discord : aucune revue requise — serveur actif', 92);
  }

  async getStatus(ctx: DeployContext): Promise<DeployStatus> {
    const guildId = ctx.externalId ?? this.guildId(ctx);
    return this.guardMock(
      ctx,
      async () => {
        await this.withRetry(() => this.api(ctx, 'GET', `/guilds/${guildId}`), 'discord.status');
        return {
          status: 'published' as const,
          externalUrl: `https://discord.com/channels/${guildId}`,
          reviewState: 'not_applicable',
        };
      },
      async () => ({
        status: 'published' as const,
        externalUrl: `https://discord.com/channels/${guildId}`,
        reviewState: 'not_applicable',
      }),
    );
  }
}

registerAdapter(new DiscordAdapter());
