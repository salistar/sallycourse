// Logique PURE de l'adapter YouTube (aucun appel réseau) — testable hors-ligne.
// Regroupe : construction du titre/description/chapitres d'une vidéo de leçon,
// nettoyage des tags, et découpage/étalement du quota YouTube Data v3.

import type { ILesson, ISection } from '../../shared.js';

/** Visibilité d'une vidéo YouTube. */
export type YouTubePrivacy = 'public' | 'unlisted' | 'private';

/** Coûts d'écriture de l'API YouTube Data v3 (unités de quota). */
export const YT_QUOTA = {
  /** Quota journalier par défaut d'un projet YouTube Data v3. */
  dailyLimit: 10_000,
  /** videos.insert (upload d'une vidéo). */
  videoInsert: 1_600,
  /** playlists.insert. */
  playlistInsert: 50,
  /** playlistItems.insert (ajout d'une vidéo à la playlist). */
  playlistItemInsert: 50,
  /** captions.insert (sous-titres). */
  captionInsert: 400,
  /** thumbnails.set (miniature). */
  thumbnailSet: 50,
} as const;

/** Coût de quota d'une leçon complète (vidéo + item playlist + caption + miniature). */
export function lessonQuotaCost(opts: { withCaption: boolean; withThumbnail: boolean }): number {
  let cost = YT_QUOTA.videoInsert + YT_QUOTA.playlistItemInsert;
  if (opts.withCaption) cost += YT_QUOTA.captionInsert;
  if (opts.withThumbnail) cost += YT_QUOTA.thumbnailSet;
  return cost;
}

/**
 * Nombre de leçons publiables dans une même fenêtre de quota, en réservant le
 * coût de création de la playlist. Retourne au moins 1 si une seule leçon tient,
 * 0 si même une leçon dépasse le budget restant.
 */
export function lessonsPerQuotaWindow(
  perLessonCost: number,
  opts: { dailyLimit?: number; reservePlaylist?: boolean } = {},
): number {
  const limit = opts.dailyLimit ?? YT_QUOTA.dailyLimit;
  const reserve = opts.reservePlaylist === false ? 0 : YT_QUOTA.playlistInsert;
  const budget = limit - reserve;
  if (perLessonCost <= 0) return 0;
  return Math.max(0, Math.floor(budget / perLessonCost));
}

/**
 * Répartit `total` leçons en lots quotidiens (fenêtres de quota). Chaque lot
 * respecte `perDay` leçons ; le premier lot porte le coût de la playlist déjà
 * intégré par lessonsPerQuotaWindow. Retourne la liste des tailles de lots.
 */
export function splitByQuota(total: number, perDay: number): number[] {
  if (total <= 0) return [];
  if (perDay <= 0) throw new Error('perDay doit être > 0 (quota insuffisant pour une leçon)');
  const batches: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const take = Math.min(perDay, remaining);
    batches.push(take);
    remaining -= take;
  }
  return batches;
}

/** Formate un nombre de secondes en horodatage de chapitre YouTube (H:MM:SS ou M:SS). */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Une entrée de chapitre (offset temporel + libellé). */
export interface Chapter {
  /** Décalage depuis le début de la vidéo, en secondes. */
  offsetSec: number;
  label: string;
}

/**
 * Construit le bloc « chapitres » YouTube à partir de sections (durées en
 * minutes). YouTube exige que le premier chapitre soit à 0:00 : on force donc
 * l'offset initial à 0. Retourne '' si moins de 2 chapitres (règle YouTube).
 */
export function buildChapters(chapters: Chapter[]): string {
  if (chapters.length < 2) return '';
  const lines = chapters.map((c, i) => {
    const offset = i === 0 ? 0 : c.offsetSec;
    return `${formatTimestamp(offset)} ${c.label.trim()}`;
  });
  // Garantit un premier chapitre à 0:00 même si l'appelant a fourni un offset non nul.
  if (!lines[0]?.startsWith('0:00')) lines[0] = `0:00 ${chapters[0]?.label.trim() ?? 'Introduction'}`;
  return lines.join('\n');
}

/**
 * Dérive les chapitres d'un cours à partir de ses sections : chaque section
 * démarre un chapitre, l'offset cumulant les durées (durationMin) des leçons
 * précédentes. Sert de « table des matières » dans la description de la vidéo
 * de présentation du cours.
 */
export function chaptersFromSections(sections: ISection[], lessons: ILesson[]): Chapter[] {
  const chapters: Chapter[] = [];
  let cumulativeSec = 0;
  const sorted = [...sections].sort((a, b) => sectionOrder(a) - sectionOrder(b));
  for (const section of sorted) {
    const sectionId = String((section as { _id?: unknown })._id ?? '');
    chapters.push({ offsetSec: cumulativeSec, label: sectionTitle(section) });
    const sectionLessons = lessons.filter((l) => String(l.sectionId) === sectionId);
    for (const lesson of sectionLessons) {
      cumulativeSec += Math.round((lesson.durationMin ?? 0) * 60);
    }
  }
  return chapters;
}

function sectionOrder(section: ISection): number {
  return (section as { order?: number }).order ?? 0;
}

function sectionTitle(section: ISection): string {
  return (section as { title?: string }).title?.trim() || 'Section';
}

/** Nettoie et borne une liste de tags YouTube (max 500 caractères cumulés). */
export function sanitizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  let totalLength = 0;
  for (const candidate of raw) {
    const tag = candidate.trim().replace(/[<>]/g, '').slice(0, 60);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    // YouTube plafonne la somme des longueurs de tags à 500 caractères.
    if (totalLength + tag.length > 500) break;
    seen.add(key);
    tags.push(tag);
    totalLength += tag.length + 1;
  }
  return tags;
}

/** Titre d'une vidéo de leçon : « 01 · Titre » (index 1-based, borné 100 car.). */
export function buildLessonTitle(index: number, title: string): string {
  const num = String(index + 1).padStart(2, '0');
  const full = `${num} · ${title.trim()}`;
  return full.length > 100 ? `${full.slice(0, 99)}…` : full;
}

export interface LessonDescriptionInput {
  courseTitle: string;
  lessonTitle: string;
  index: number;
  total: number;
  summary?: string;
  /** Chapitres internes à la vidéo (facultatif). */
  chapters?: Chapter[];
  /** Ligne de marque affichée en pied de description. */
  brandLine?: string;
}

/**
 * Construit la description d'une vidéo de leçon : accroche + résumé + éventuels
 * chapitres timestampés + pied de marque. Bornée à ~5000 caractères (limite
 * YouTube). Déterministe (aucun horodatage courant).
 */
export function buildLessonDescription(input: LessonDescriptionInput): string {
  const blocks: string[] = [];
  blocks.push(`${input.lessonTitle}`);
  blocks.push(`Leçon ${input.index + 1} / ${input.total} — ${input.courseTitle}`);
  if (input.summary?.trim()) blocks.push(input.summary.trim());
  const chapterBlock = input.chapters ? buildChapters(input.chapters) : '';
  if (chapterBlock) blocks.push(`Chapitres :\n${chapterBlock}`);
  blocks.push(input.brandLine ?? 'Cours généré par SALISTAR — SallyCourse.');
  return blocks.join('\n\n').slice(0, 5000);
}
