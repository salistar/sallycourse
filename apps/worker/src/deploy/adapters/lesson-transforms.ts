// Transformations PURES partagées par les adapters (Podia, Gumroad, Skillshare).
// Aucune I/O réseau ni accès DB : testables hors-ligne (vitest). Regroupe la
// logique métier réutilisable :
//   - classification des leçons (vidéo vs. lecture/ressource) ;
//   - conversion d'une leçon article/TP en « ressource jointe » pour les
//     plateformes vidéo-only (Skillshare) ;
//   - sélection du TP principal (source du projet de classe Skillshare) ;
//   - construction d'une description produit à partir du cours (Gumroad).

import type { ICourse, ILesson } from '../../shared.js';

/** Une leçon est « vidéo » si son type l'est ET qu'un asset vidéo existe. */
export function isVideoLesson(lesson: ILesson): boolean {
  return lesson.type === 'video' && Boolean(lesson.assets?.videoUrl);
}

/**
 * Ressource jointe issue d'une leçon non-vidéo (article/TP/quiz). Sur une
 * plateforme vidéo-only, ces leçons deviennent des documents joints à la classe
 * ou des « leçons lecture » (titre + corps texte).
 */
export interface LessonResource {
  /** Index absolu de la leçon dans ctx.lessons (traçabilité checkpoint). */
  index: number;
  title: string;
  /** Type d'origine (article, tp, quiz…). */
  kind: string;
  /** Nom de fichier suggéré pour la ressource (slug + extension). */
  filename: string;
  /** Corps texte (Markdown de l'article, énoncé du TP…) — vide si indisponible. */
  body: string;
}

/** Slug ASCII simple, sûr comme composant de nom de fichier. */
export function slugifyTitle(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'lecon'
  );
}

/**
 * Convertit une leçon non-vidéo en ressource jointe. `body` est fourni par
 * l'appelant (le worker le télécharge depuis le stockage) ; ici on ne fait que
 * mettre en forme titre/nom de fichier/type — d'où la testabilité pure.
 */
export function articleToResource(lesson: ILesson, index: number, body = ''): LessonResource {
  const ext = lesson.type === 'quiz' ? 'txt' : 'md';
  return {
    index,
    title: lesson.title,
    kind: lesson.type,
    filename: `${String(index + 1).padStart(2, '0')}-${slugifyTitle(lesson.title)}.${ext}`,
    body,
  };
}

/**
 * Sélectionne le TP « principal » d'un cours : la leçon de type 'tp' la plus
 * longue (durationMin), à défaut la première rencontrée. Sert de source au
 * projet de classe Skillshare. Retourne null si aucun TP.
 */
export function selectMainTp(lessons: ILesson[]): ILesson | null {
  const tps = lessons.filter((l) => l.type === 'tp');
  if (tps.length === 0) return null;
  return tps.reduce((best, cur) => {
    const bestDur = best.durationMin ?? 0;
    const curDur = cur.durationMin ?? 0;
    return curDur > bestDur ? cur : best;
  });
}

/**
 * Partitionne les leçons en vidéos (uploadables telles quelles) et non-vidéos
 * (à convertir en ressources). L'index absolu est conservé pour le checkpoint.
 */
export function partitionLessons(lessons: ILesson[]): {
  videos: { lesson: ILesson; index: number }[];
  resources: { lesson: ILesson; index: number }[];
} {
  const videos: { lesson: ILesson; index: number }[] = [];
  const resources: { lesson: ILesson; index: number }[] = [];
  lessons.forEach((lesson, index) => {
    if (isVideoLesson(lesson)) videos.push({ lesson, index });
    else resources.push({ lesson, index });
  });
  return { videos, resources };
}

/** Description marketing du cours (fallback si aucune n'est générée). */
function extractMarketingDescription(marketing: unknown): string | undefined {
  const content = (marketing as { content?: { udemyDescription?: unknown; summary?: unknown } } | null)
    ?.content;
  const candidate = content?.udemyDescription ?? content?.summary;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

/**
 * Construit une description produit à partir du cours (Gumroad, Podia). Reprend
 * la description marketing si disponible, sinon compose un texte à partir du
 * titre, du niveau et du nombre de leçons.
 */
export function buildProductDescription(course: ICourse, lessonCount: number): string {
  const marketing = extractMarketingDescription(course.marketing);
  if (marketing) return marketing;
  return (
    `${course.title}\n\n` +
    `Cours ${course.difficulty} — ${lessonCount} leçon(s).\n` +
    `Contenu complet (vidéos, articles, TP et quiz) prêt à suivre.`
  );
}
