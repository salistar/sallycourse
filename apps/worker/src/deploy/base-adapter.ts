// Classe de base des adapters de déploiement : factorise la logique COMMUNE
// (lecture/écriture du checkpoint sur Deployment, retry, log structuré vers
// Deployment.logs + publishProgress, garde mock). Les adapters concrets
// (Prompt 112) héritent et n'implémentent que les méthodes plateforme.

import type { DeploymentMode } from '../shared.js';
import type {
  DeployCheckpoint,
  DeployContext,
  DeployStatus,
  DeploymentAdapter,
} from './types.js';
import type { ILesson } from '../shared.js';

/** Options de retry : nombre de tentatives + délai de base (backoff linéaire). */
export interface RetryOptions {
  attempts?: number;
  /** Délai de base en ms (tentative n → n * baseDelayMs). 0 = pas d'attente. */
  baseDelayMs?: number;
  /** Étiquette pour les logs (nom de l'opération). */
  label?: string;
}

/** Pause utilitaire (contournée quand baseDelayMs = 0, notamment en test). */
function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exécute `fn` avec retry : jusqu'à `attempts` essais, backoff linéaire
 * (baseDelayMs, 2×, 3×…). Relance la dernière erreur si tous les essais
 * échouent. `attempts` ≥ 1 (0 ou négatif est ramené à 1).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 0;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await delay(baseDelayMs * attempt);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Échec après ${attempts} tentative(s)${options.label ? ` (${options.label})` : ''}`);
}

/**
 * Classe abstraite : logique transverse d'un adapter de déploiement. Les
 * méthodes du contrat (authenticate, createCourse…) restent abstraites.
 */
export abstract class BaseDeploymentAdapter implements DeploymentAdapter {
  abstract platform: string;
  abstract capabilities: { modes: DeploymentMode[]; needsBrowser: boolean };

  abstract authenticate(ctx: DeployContext): Promise<void>;
  abstract createCourse(ctx: DeployContext): Promise<{ externalId: string }>;
  abstract uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void>;

  /**
   * Mise à jour ciblée d'une leçon déjà déployée (P46). Implémentation par
   * défaut = ré-upload complet via `uploadLesson` (fallback universel). Un
   * adapter peut surcharger pour un remplacement plus fin (ex. réutiliser le
   * même item de curriculum au lieu d'en recréer un). Non abstraite : les
   * adapters existants héritent du fallback sans modification.
   */
  async updateLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void> {
    await this.uploadLesson(ctx, lesson, index);
  }

  abstract setLandingPage(ctx: DeployContext): Promise<void>;
  abstract submitForReview(ctx: DeployContext): Promise<void>;
  abstract getStatus(ctx: DeployContext): Promise<DeployStatus>;

  /**
   * Ajout de sous-titres traduits sur une leçon déjà déployée (P92). Défaut :
   * no-op documenté — journalise l'absence de support et retourne sans erreur.
   * Les adapters qui exposent réellement une notion de captions (Udemy,
   * YouTube) surchargent cette méthode ; les autres héritent de ce repli sans
   * modification.
   */
  async addCaptions(
    ctx: DeployContext,
    _lesson: ILesson,
    _index: number,
    locale: string,
    _srtContent: string,
  ): Promise<void> {
    await this.log(
      ctx,
      'info',
      `addCaptions non supporté par l'adapter « ${this.platform} » — sous-titres ${locale} ignorés (no-op).`,
    );
  }

  /** Retry par défaut de l'adapter (surchargeable). */
  protected retryOptions(): RetryOptions {
    return { attempts: 3, baseDelayMs: 1_000 };
  }

  /** withRetry lié aux options de l'adapter (les sous-classes l'utilisent). */
  protected async withRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
    return withRetry(fn, { ...this.retryOptions(), label });
  }

  // ── Checkpoint ────────────────────────────────────────────────
  /** Lit le checkpoint courant depuis le contexte. */
  protected readCheckpoint(ctx: DeployContext): DeployCheckpoint {
    return ctx.checkpoint;
  }

  /**
   * Écrit le checkpoint (contexte + Deployment) et persiste. Point de reprise :
   * après un upload de leçon réussi, on avance lessonIndex pour ne pas
   * ré-uploader en cas de reprise.
   */
  protected async saveCheckpoint(
    ctx: DeployContext,
    checkpoint: DeployCheckpoint,
  ): Promise<void> {
    ctx.checkpoint = checkpoint;
    ctx.deployment.checkpoint = { lessonIndex: checkpoint.lessonIndex, step: checkpoint.step };
    if (!ctx.mock) {
      await ctx.deployment.save();
    }
  }

  // ── Log structuré ─────────────────────────────────────────────
  /**
   * Log structuré : pino + entrée Deployment.logs + publishProgress. En mock,
   * préfixe « [mock] » et n'écrit pas en base (best-effort). `progress` est
   * optionnel (undefined → pas de publication de progression).
   */
  protected async log(
    ctx: DeployContext,
    level: 'info' | 'warn' | 'error',
    msg: string,
    progress?: number,
  ): Promise<void> {
    const line = ctx.mock ? `[mock] ${msg}` : msg;
    const courseId = String((ctx.course as { _id?: unknown })._id ?? '');
    ctx.logger[level]({ platform: ctx.platform, courseId }, line);

    ctx.deployment.logs.push({ ts: new Date(), level, msg: line });
    if (!ctx.mock) {
      await ctx.deployment.save().catch(() => undefined);
    }
    if (progress !== undefined) {
      await ctx.publishProgress(progress, line, level).catch(() => undefined);
    }
  }

  /**
   * Garde mock : exécute `real` hors mock, sinon `simulated` (ou une valeur par
   * défaut). Évite tout appel réseau réel quand ctx.mock est vrai.
   */
  protected async guardMock<T>(
    ctx: DeployContext,
    real: () => Promise<T>,
    simulated: () => T | Promise<T>,
  ): Promise<T> {
    return ctx.mock ? simulated() : real();
  }
}
