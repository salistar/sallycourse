// Orchestration de la MISE À JOUR ciblée d'un déploiement (Prompt 46).
//
// Isolé du processor pour rester lisible : à partir d'un Deployment déjà publié
// et de l'instantané des leçons déployées (deployedVersions), on détecte les
// leçons modifiées (deploy/updates.ts), on re-uploade UNIQUEMENT celles-là via
// l'adapter (updateLesson, fallback uploadLesson), puis on met à jour
// l'instantané. Reprise par checkpoint (step 'update', curseur = index dans la
// liste des updates). MOCK respecté (aucune persistance, logs « [mock] »).

import type {
  BoundPublishProgress,
  DeployContext,
  DeploymentAdapter,
  DeployResult,
} from './types.js';
import {
  detectLessonUpdates,
  runResumableUpdates,
  nextSnapshot,
  type DeployedLessonSnapshot,
  type LessonUpdate,
} from './updates.js';
import type { ILesson } from '../shared.js';

/** Lit l'instantané déployé depuis le Deployment (tolérant au champ absent). */
export function readDeployedSnapshot(ctx: DeployContext): DeployedLessonSnapshot[] {
  const raw = (ctx.deployment as { deployedVersions?: unknown }).deployedVersions;
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => {
    const e = (v ?? {}) as { lessonId?: unknown; contentHash?: unknown; version?: unknown };
    return {
      lessonId: String(e.lessonId ?? ''),
      contentHash: String(e.contentHash ?? ''),
      version: typeof e.version === 'number' ? e.version : 1,
    };
  });
}

/** Persiste l'instantané déployé sur le Deployment (hors mock). */
export async function writeDeployedSnapshot(
  ctx: DeployContext,
  snapshot: readonly DeployedLessonSnapshot[],
): Promise<void> {
  const now = new Date();
  (ctx.deployment as { deployedVersions?: unknown }).deployedVersions = snapshot.map((s) => ({
    lessonId: s.lessonId,
    contentHash: s.contentHash,
    version: s.version,
    deployedAt: now,
  }));
  if (!ctx.mock) await ctx.deployment.save().catch(() => undefined);
}

/**
 * Exécute la mise à jour ciblée. Retourne un DeployResult où `lessonsUploaded`
 * = nombre de leçons re-uploadées. Si aucune leçon n'a changé, ne touche à rien
 * (0 upload) et laisse le statut inchangé.
 */
export async function runDeploymentUpdate(
  adapter: DeploymentAdapter,
  ctx: DeployContext,
  report: BoundPublishProgress,
): Promise<DeployResult> {
  const previous = readDeployedSnapshot(ctx);
  const plan = detectLessonUpdates(ctx.lessons as ILesson[], previous);

  await report(5, `Analyse des modifications : ${plan.updates.length} leçon(s) impactée(s)`);

  if (plan.updates.length === 0) {
    ctx.deployment.logs.push({
      ts: new Date(),
      level: 'info',
      msg: `${ctx.mock ? '[mock] ' : ''}aucune leçon modifiée depuis le dernier déploiement — rien à mettre à jour`,
    });
    if (!ctx.mock) await ctx.deployment.save().catch(() => undefined);
    await report(100, 'Aucune mise à jour nécessaire');
    return {
      platform: ctx.platform,
      status: ctx.deployment.status,
      externalId: ctx.externalId ?? (ctx.deployment as { externalId?: string }).externalId,
      externalUrl: ctx.deployment.externalUrl,
      lessonsUploaded: 0,
    };
  }

  // Authentification requise pour re-pousser des assets sur la plateforme.
  await adapter.authenticate(ctx);
  // On réutilise l'externalId du déploiement précédent (cours déjà créé).
  ctx.externalId = ctx.externalId ?? (ctx.deployment as { externalId?: string }).externalId;

  const applied: LessonUpdate[] = [];
  await runResumableUpdates(
    plan.updates,
    ctx.checkpoint,
    async (update) => {
      const lesson = ctx.lessons[update.index] as ILesson;
      // updateLesson est fournie par la classe de base (fallback uploadLesson).
      if (typeof adapter.updateLesson === 'function') {
        await adapter.updateLesson(ctx, lesson, update.index);
      } else {
        await adapter.uploadLesson(ctx, lesson, update.index);
      }
      applied.push(update);
    },
    async (nextCursor) => {
      ctx.checkpoint = { lessonIndex: nextCursor, step: 'update' };
      ctx.deployment.checkpoint = { lessonIndex: nextCursor, step: 'update' };
      if (!ctx.mock) await ctx.deployment.save().catch(() => undefined);
      const pct = 10 + Math.round((nextCursor / Math.max(1, plan.updates.length)) * 80);
      await report(pct, `Leçon mise à jour ${nextCursor}/${plan.updates.length}`);
    },
  );

  // Nouvel instantané : les leçons re-uploadées passent à version+1.
  const snapshot = nextSnapshot(previous, applied);
  await writeDeployedSnapshot(ctx, snapshot);

  // Curseur d'update consommé : on remet le checkpoint sur 'done'.
  ctx.deployment.checkpoint = { lessonIndex: ctx.lessons.length, step: 'done' };
  ctx.deployment.logs.push({
    ts: new Date(),
    level: 'info',
    msg: `${ctx.mock ? '[mock] ' : ''}mise à jour terminée : ${applied.length} leçon(s) re-uploadée(s)`,
  });
  if (!ctx.mock) await ctx.deployment.save().catch(() => undefined);

  await report(100, `Mise à jour terminée : ${applied.length} leçon(s)`);

  return {
    platform: ctx.platform,
    status: ctx.deployment.status,
    externalId: ctx.externalId,
    externalUrl: ctx.deployment.externalUrl,
    lessonsUploaded: applied.length,
  };
}
