// Prompt 45 — Adaptation du contenu par plateforme.
//
// Module PUR de transformation appliqué AVANT l'upload : chaque plateforme a un
// format cible différent, et regroupe/convertit les leçons en conséquence.
//
//   - youtube    : regroupe les leçons courtes en vidéos de 10 min+ avec
//                  chapitres (une vidéo peut couvrir plusieurs leçons).
//   - skillshare : tout est traité comme vidéo (une unité vidéo par leçon).
//   - gumroad    : tout est empaqueté dans un unique ZIP téléchargeable.
//   - udemy      : conserve la structure telle quelle (1 unité par leçon).
//
// La construction du plan (`adaptForPlatform`) est DÉTERMINISTE et sans effet de
// bord : testable hors-ligne. La reformulation des descriptions par ton de
// plateforme passe par Claude (`reformulateDescriptions`) mais tombe sur une
// version locale déterministe en mode mock — aucun appel réseau requis en test.

import type { ICourse, ILesson, ISection, LessonType } from '../shared.js';
import { getConfig } from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import { z } from 'zod';

/** Format d'unité d'upload produit par l'adaptation. */
export type UploadUnitFormat = 'video' | 'article' | 'zip';

/** Un chapitre interne à une vidéo groupée (offset + libellé). */
export interface UploadChapter {
  /** Décalage depuis le début de l'unité, en secondes. */
  offsetSec: number;
  label: string;
}

/**
 * Une unité d'upload : bloc atomique poussé vers la plateforme. Selon la
 * plateforme, une unité correspond à une leçon (Udemy) ou en regroupe plusieurs
 * (YouTube, Gumroad). `lessonIndices` référence les positions absolues dans le
 * tableau `lessons` d'origine (permet reprise/mapping vers le stockage).
 */
export interface UploadUnit {
  /** Position 0-based de l'unité dans le plan. */
  index: number;
  /** Format de l'unité côté plateforme. */
  format: UploadUnitFormat;
  /** Titre de l'unité (peut synthétiser plusieurs leçons). */
  title: string;
  /** Description (reformulée par plateforme ultérieurement si besoin). */
  description: string;
  /** Index absolus des leçons couvertes par l'unité (≥ 1). */
  lessonIndices: number[];
  /** Durée totale estimée de l'unité, en minutes. */
  durationMin: number;
  /** Chapitres internes (renseignés quand l'unité regroupe des leçons). */
  chapters: UploadChapter[];
}

/** Plan d'upload complet produit pour une plateforme donnée. */
export interface UploadPlan {
  platform: string;
  /** Stratégie appliquée (documentaire). */
  strategy: 'per-lesson' | 'grouped-video' | 'single-zip' | 'all-video';
  units: UploadUnit[];
  /** Nombre de leçons d'origine couvertes (contrôle d'intégrité). */
  totalLessons: number;
}

/** Durée cible minimale d'une vidéo YouTube groupée, en minutes. */
export const YOUTUBE_MIN_VIDEO_MIN = 10;
/** Durée par défaut attribuée à une leçon sans durationMin, en minutes. */
const DEFAULT_LESSON_MIN = 5;

/** Durée d'une leçon en minutes (défaut si absente/invalide). */
function lessonDuration(lesson: ILesson): number {
  const d = lesson.durationMin;
  return typeof d === 'number' && d > 0 ? d : DEFAULT_LESSON_MIN;
}

/** Résumé disponible d'une leçon (contenu réel prioritaire sur l'outline). */
function lessonSummary(lesson: ILesson): string {
  return (lesson.generatedSummary ?? lesson.summary ?? '').trim();
}

/**
 * Regroupe les leçons consécutives en vidéos d'au moins `minMinutes`. On accumule
 * les leçons dans un groupe courant jusqu'à atteindre la durée cible, puis on
 * ferme le groupe. Le dernier groupe est fusionné avec le précédent s'il reste
 * en-dessous de la cible (évite une vidéo orpheline trop courte), sauf s'il est
 * seul. Fonction PURE.
 */
export function groupLessonsByDuration(
  lessons: ILesson[],
  minMinutes: number = YOUTUBE_MIN_VIDEO_MIN,
): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let currentMin = 0;

  lessons.forEach((lesson, index) => {
    current.push(index);
    currentMin += lessonDuration(lesson);
    if (currentMin >= minMinutes) {
      groups.push(current);
      current = [];
      currentMin = 0;
    }
  });

  // Reliquat : fusionne avec le groupe précédent si trop court, sinon garde tel quel.
  if (current.length > 0) {
    const reliquatMin = current.reduce((acc, i) => acc + lessonDuration(lessons[i]!), 0);
    if (groups.length > 0 && reliquatMin < minMinutes) {
      groups[groups.length - 1]!.push(...current);
    } else {
      groups.push(current);
    }
  }

  return groups;
}

/** Construit les chapitres internes d'une vidéo groupée (offset cumulé). */
function chaptersForGroup(lessons: ILesson[], indices: number[]): UploadChapter[] {
  const chapters: UploadChapter[] = [];
  let offsetSec = 0;
  for (const i of indices) {
    const lesson = lessons[i]!;
    chapters.push({ offsetSec, label: lesson.title.trim() || `Leçon ${i + 1}` });
    offsetSec += Math.round(lessonDuration(lesson) * 60);
  }
  return chapters;
}

/** Titre d'une unité groupée : titre de la 1re leçon (+ « … et N autres »). */
function groupTitle(lessons: ILesson[], indices: number[]): string {
  const first = lessons[indices[0]!]!.title.trim() || `Leçon ${indices[0]! + 1}`;
  if (indices.length === 1) return first;
  return `${first} (+${indices.length - 1})`;
}

/** Description concaténée d'une unité groupée (résumés des leçons couvertes). */
function groupDescription(course: ICourse, lessons: ILesson[], indices: number[]): string {
  const parts = indices
    .map((i) => lessonSummary(lessons[i]!))
    .filter((s) => s.length > 0);
  const head = `${course.title} — ${indices.length} leçon${indices.length > 1 ? 's' : ''}.`;
  return [head, ...parts].join('\n\n').trim();
}

/** Mappe un type de leçon vers un format d'unité (fallback article). */
function formatFromLessonType(type: LessonType): UploadUnitFormat {
  return type === 'video' ? 'video' : 'article';
}

/**
 * Construit le plan d'upload d'un cours pour une plateforme. Fonction PURE et
 * déterministe (aucun appel réseau, aucune reformulation LLM ici — voir
 * `reformulateDescriptions`). Plateforme inconnue → stratégie per-lesson (sûre).
 */
export function adaptForPlatform(
  platform: string,
  course: ICourse,
  lessons: ILesson[],
): UploadPlan {
  const totalLessons = lessons.length;
  const key = platform.toLowerCase();

  switch (key) {
    case 'youtube':
      return buildGroupedVideoPlan(platform, course, lessons);
    case 'skillshare':
      return buildAllVideoPlan(platform, course, lessons);
    case 'gumroad':
      return buildSingleZipPlan(platform, course, lessons);
    case 'udemy':
    default:
      return {
        platform,
        strategy: 'per-lesson',
        units: perLessonUnits(course, lessons, (l) => formatFromLessonType(l.type)),
        totalLessons,
      };
  }
}

/** Une unité par leçon, format dérivé d'un mappeur (Udemy = type d'origine). */
function perLessonUnits(
  course: ICourse,
  lessons: ILesson[],
  format: (lesson: ILesson) => UploadUnitFormat,
): UploadUnit[] {
  return lessons.map((lesson, index) => ({
    index,
    format: format(lesson),
    title: lesson.title.trim() || `Leçon ${index + 1}`,
    description: groupDescription(course, lessons, [index]),
    lessonIndices: [index],
    durationMin: lessonDuration(lesson),
    chapters: [],
  }));
}

/** YouTube : regroupe les leçons courtes en vidéos ≥ 10 min avec chapitres. */
function buildGroupedVideoPlan(platform: string, course: ICourse, lessons: ILesson[]): UploadPlan {
  const groups = groupLessonsByDuration(lessons, YOUTUBE_MIN_VIDEO_MIN);
  const units: UploadUnit[] = groups.map((indices, index) => ({
    index,
    format: 'video',
    title: groupTitle(lessons, indices),
    description: groupDescription(course, lessons, indices),
    lessonIndices: indices,
    durationMin: indices.reduce((acc, i) => acc + lessonDuration(lessons[i]!), 0),
    chapters: indices.length > 1 ? chaptersForGroup(lessons, indices) : [],
  }));
  return { platform, strategy: 'grouped-video', units, totalLessons: lessons.length };
}

/** Skillshare : tout en vidéo (une unité vidéo par leçon, quel que soit le type). */
function buildAllVideoPlan(platform: string, course: ICourse, lessons: ILesson[]): UploadPlan {
  return {
    platform,
    strategy: 'all-video',
    units: perLessonUnits(course, lessons, () => 'video'),
    totalLessons: lessons.length,
  };
}

/** Gumroad : tout le cours dans un unique ZIP téléchargeable. */
function buildSingleZipPlan(platform: string, course: ICourse, lessons: ILesson[]): UploadPlan {
  const indices = lessons.map((_, i) => i);
  const durationMin = lessons.reduce((acc, l) => acc + lessonDuration(l), 0);
  const unit: UploadUnit = {
    index: 0,
    format: 'zip',
    title: course.title.trim() || 'Cours',
    description: groupDescription(course, lessons, indices),
    lessonIndices: indices,
    durationMin,
    chapters: indices.length > 1 ? chaptersForGroup(lessons, indices) : [],
  };
  return {
    platform,
    strategy: 'single-zip',
    units: lessons.length > 0 ? [unit] : [],
    totalLessons: lessons.length,
  };
}

/* ------------------------------------------------------------------ */
/* Reformulation des descriptions par ton de plateforme (Claude/mock)  */
/* ------------------------------------------------------------------ */

/** Consignes de ton par plateforme (le ton YouTube ≠ Udemy). */
const PLATFORM_TONE: Record<string, string> = {
  youtube:
    'Ton YouTube : accrocheur, direct, orienté clic. Phrases courtes, incitation à regarder la suite. Émojis sobres autorisés.',
  udemy:
    'Ton Udemy : pédagogique et professionnel. Met en avant les objectifs d’apprentissage et les acquis concrets.',
  skillshare:
    'Ton Skillshare : créatif et communautaire, orienté projet pratique. Invite à réaliser et partager.',
  gumroad:
    'Ton Gumroad : orienté produit et valeur. Décrit ce que l’acheteur obtient et le bénéfice concret du pack.',
};

/** Ton par défaut (plateforme non listée). */
const DEFAULT_TONE = 'Ton clair, professionnel et engageant.';

/** Schéma de sortie de la reformulation : descriptions indexées par position. */
const reformulateSchema = z.object({
  descriptions: z.array(z.string().min(1)),
});
export type ReformulateResult = z.infer<typeof reformulateSchema>;

/**
 * Reformule les descriptions d'un plan selon le ton de la plateforme. Retourne un
 * NOUVEAU plan (immuable) avec les descriptions mises à jour.
 *
 * - Mode mock / MOCK_PROVIDERS : reformulation LOCALE déterministe (préfixe de
 *   ton), aucun appel réseau — testable hors-ligne.
 * - Sinon : un seul appel `callClaudeJson` (batch de toutes les descriptions).
 *
 * En cas de réponse LLM de taille inattendue, on conserve les descriptions
 * d'origine pour les entrées manquantes (robustesse, jamais de perte de contenu).
 */
export async function reformulateDescriptions(plan: UploadPlan): Promise<UploadPlan> {
  if (plan.units.length === 0) return plan;
  const tone = PLATFORM_TONE[plan.platform.toLowerCase()] ?? DEFAULT_TONE;
  const config = getConfig();
  const mock = config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY;

  if (mock) {
    return {
      ...plan,
      units: plan.units.map((u) => ({ ...u, description: mockReformulate(plan.platform, u.description) })),
    };
  }

  const system =
    `Tu reformules des descriptions de contenu pédagogique pour la plateforme « ${plan.platform} ». ` +
    `${tone} Conserve le sens et la langue (français). Réponds en JSON : ` +
    `{ "descriptions": [ ... ] } avec EXACTEMENT une chaîne par description fournie, dans le même ordre.`;
  const user = JSON.stringify({
    platform: plan.platform,
    descriptions: plan.units.map((u) => u.description),
  });

  const result = await callClaudeJson({ schema: reformulateSchema, system, user });
  return {
    ...plan,
    units: plan.units.map((u, i) => ({
      ...u,
      description: result.descriptions[i]?.trim() || u.description,
    })),
  };
}

/** Reformulation locale déterministe (mode mock) — préfixe explicite « [ton] ». */
export function mockReformulate(platform: string, description: string): string {
  const label = platform.toLowerCase();
  return `[mock:${label}] ${description}`.trim();
}
