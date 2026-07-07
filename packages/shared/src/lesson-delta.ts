// Détection de delta de leçon pour la MISE À JOUR ciblée d'un déploiement (P46).
//
// Logique PURE et SANS dépendance sur le modèle Mongo (types structurels) : elle
// est partagée entre le worker (deploy/updates.ts, re-export) et le web (API des
// mises à jour). Une seule source de vérité pour l'empreinte de contenu, afin que
// « ce que le web propose de mettre à jour » == « ce que le worker re-uploade ».

import { createHash } from 'node:crypto';

/** Projection structurelle du contenu diffusable d'une leçon (indépendante de Mongo). */
export interface LessonContentInput {
  _id?: unknown;
  id?: unknown;
  title?: string;
  type?: string;
  status?: string;
  contentHash?: string;
  assets?: {
    videoUrl?: string;
    articleMd?: string;
    srtUrl?: string;
    vttUrl?: string;
    audioUrl?: string;
    slides?: string[];
  };
}

/** Instantané d'une leçon telle que déployée (référence du diff). */
export interface DeployedLessonSnapshot {
  lessonId: string;
  contentHash: string;
  /** Version incrémentée à chaque (re)déploiement de la leçon. */
  version: number;
}

/** Point de reprise (aligné sur DeployCheckpoint du worker). */
export interface LessonDeltaCheckpoint {
  lessonIndex: number;
  step: string;
}

export type LessonChangeKind = 'new' | 'modified';

/** Une leçon impactée par une mise à jour (à re-uploader). */
export interface LessonUpdate {
  lessonId: string;
  /** Index ABSOLU dans la liste ordonnée des leçons (== position d'upload). */
  index: number;
  title: string;
  kind: LessonChangeKind;
  contentHash: string;
  previousHash?: string;
  previousVersion: number;
}

/** Résultat du diff : leçons impactées + total. */
export interface UpdatePlan {
  updates: LessonUpdate[];
  total: number;
}

/** Identifiant string robuste (doc lean ou hydraté). */
function idOf(lesson: LessonContentInput): string {
  return String(lesson._id ?? lesson.id ?? '');
}

/**
 * Empreinte déterministe du contenu DIFFUSABLE d'une leçon : titre, type,
 * pointeurs d'assets (clés S3) et `contentHash` source éventuel. Deux leçons au
 * même rendu produisent le même hash ; une régénération qui change la vidéo,
 * l'article, l'audio ou les slides change le hash.
 */
export function lessonContentHash(lesson: LessonContentInput): string {
  const a = lesson.assets ?? {};
  const projection = {
    title: lesson.title ?? '',
    type: lesson.type ?? '',
    contentHash: lesson.contentHash ?? '',
    videoUrl: a.videoUrl ?? '',
    articleMd: a.articleMd ?? '',
    srtUrl: a.srtUrl ?? '',
    vttUrl: a.vttUrl ?? '',
    audioUrl: a.audioUrl ?? '',
    slides: Array.isArray(a.slides) ? a.slides.join('|') : '',
  };
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

/** Indexe un instantané par lessonId. */
export function indexSnapshot(
  snapshots: readonly DeployedLessonSnapshot[],
): Map<string, DeployedLessonSnapshot> {
  const map = new Map<string, DeployedLessonSnapshot>();
  for (const s of snapshots) map.set(s.lessonId, s);
  return map;
}

/**
 * Compare l'état courant des leçons (ordonnées) à l'instantané du dernier
 * déploiement et renvoie les leçons à re-uploader ('new' | 'modified'). Les
 * leçons non 'ready' sont IGNORÉES (asset incomplet). Ordre = index absolu.
 */
export function detectLessonUpdates(
  lessons: readonly LessonContentInput[],
  deployed: readonly DeployedLessonSnapshot[],
): UpdatePlan {
  const byId = indexSnapshot(deployed);
  const updates: LessonUpdate[] = [];

  lessons.forEach((lesson, index) => {
    if (lesson.status !== 'ready') return;
    const lessonId = idOf(lesson);
    if (!lessonId) return;

    const hash = lessonContentHash(lesson);
    const prev = byId.get(lessonId);

    if (!prev) {
      updates.push({ lessonId, index, title: lesson.title ?? '', kind: 'new', contentHash: hash, previousVersion: 0 });
      return;
    }
    if (prev.contentHash !== hash) {
      updates.push({
        lessonId,
        index,
        title: lesson.title ?? '',
        kind: 'modified',
        contentHash: hash,
        previousHash: prev.contentHash,
        previousVersion: prev.version,
      });
    }
  });

  return { updates, total: lessons.length };
}

/** Vrai s'il existe au moins une leçon impactée. */
export function hasPendingUpdates(plan: UpdatePlan): boolean {
  return plan.updates.length > 0;
}

/**
 * Nouvel instantané APRÈS mise à jour : on repart de l'ancien et on
 * remplace/ajoute les leçons re-uploadées (version+1). Pure.
 */
export function nextSnapshot(
  previous: readonly DeployedLessonSnapshot[],
  applied: readonly LessonUpdate[],
): DeployedLessonSnapshot[] {
  const map = indexSnapshot(previous);
  for (const u of applied) {
    map.set(u.lessonId, { lessonId: u.lessonId, contentHash: u.contentHash, version: u.previousVersion + 1 });
  }
  return [...map.values()];
}

/**
 * Curseur (0-based) dans la liste des updates à partir duquel reprendre, compte
 * tenu d'un checkpoint (step 'update' + lessonIndex = curseur).
 */
export function pendingUpdateCursor(total: number, checkpoint: LessonDeltaCheckpoint): number {
  if (checkpoint.step !== 'update') return 0;
  return Math.max(0, Math.min(checkpoint.lessonIndex, total));
}

/**
 * Exécute les re-uploads restants (reprise sur checkpoint), curseur avancé APRÈS
 * chaque succès. Retourne le nombre de leçons re-uploadées.
 */
export async function runResumableUpdates(
  updates: readonly LessonUpdate[],
  checkpoint: LessonDeltaCheckpoint,
  reupload: (update: LessonUpdate, cursor: number) => Promise<void>,
  advance: (nextCursor: number) => Promise<void>,
): Promise<number> {
  let applied = 0;
  const start = pendingUpdateCursor(updates.length, checkpoint);
  for (let cursor = start; cursor < updates.length; cursor += 1) {
    await reupload(updates[cursor]!, cursor);
    applied += 1;
    await advance(cursor + 1);
  }
  return applied;
}
