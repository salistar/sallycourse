// Transformation PURE cours → arbre (sections → leçons), partagée par les
// adapters LMS (Teachable, Thinkific…). Regroupe les leçons sous leur section
// d'origine en respectant l'ordre, et projette chaque leçon vers un contenu
// neutre (video/text/quiz) que chaque adapter mappe ensuite sur son API REST.
// Sans I/O ni réseau : testable en isolation.

import type { ICourse, ILesson, ISection } from '../../shared.js';

/** Type de contenu neutre côté LMS (indépendant de la plateforme cible). */
export type LmsContentType = 'video' | 'text' | 'quiz';

/** Une leçon projetée : type LMS + index absolu (position d'upload). */
export interface MappedLesson {
  /** Index absolu dans ctx.lessons (== position de checkpoint). */
  index: number;
  title: string;
  contentType: LmsContentType;
  lesson: ILesson;
}

/** Une section avec ses leçons ordonnées. */
export interface MappedSection {
  title: string;
  order: number;
  lessons: MappedLesson[];
}

/** Arbre complet prêt à publier. */
export interface MappedCourse {
  title: string;
  sections: MappedSection[];
  /** Nombre total de leçons (toutes sections confondues). */
  lessonCount: number;
}

/**
 * Projette le type interne de leçon (video/article/tp/quiz) vers le type de
 * contenu LMS. Les leçons « tp » deviennent du texte (énoncé + étapes) faute
 * d'un type dédié côté LMS ; « quiz » reste un quiz ; « video » reste vidéo.
 */
export function mapLessonContentType(lesson: ILesson): LmsContentType {
  switch (lesson.type) {
    case 'video':
      return 'video';
    case 'quiz':
      return 'quiz';
    case 'article':
    case 'tp':
    default:
      return 'text';
  }
}

/**
 * Construit l'arbre cours → sections → leçons. `lessons` est supposé trié par
 * ordre absolu (== ordre d'upload) : l'index absolu est conservé pour le
 * checkpoint. Les leçons sont rattachées à leur section via sectionId ; une
 * leçon orpheline (section inconnue) tombe dans une section « Divers » finale.
 * Les sections sont triées par `order`, les leçons dans l'ordre de `lessons`.
 */
export function mapCourseStructure(
  course: ICourse,
  sections: ISection[],
  lessons: ILesson[],
): MappedCourse {
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  // Groupe des leçons par sectionId (clé = string de l'ObjectId).
  const bySection = new Map<string, MappedLesson[]>();
  const orphans: MappedLesson[] = [];
  const knownIds = new Set(sorted.map((s) => String((s as { _id?: unknown })._id ?? '')));

  lessons.forEach((lesson, index) => {
    const mapped: MappedLesson = {
      index,
      title: lesson.title,
      contentType: mapLessonContentType(lesson),
      lesson,
    };
    const sid = String(lesson.sectionId ?? '');
    if (sid && knownIds.has(sid)) {
      const bucket = bySection.get(sid);
      if (bucket) bucket.push(mapped);
      else bySection.set(sid, [mapped]);
    } else {
      orphans.push(mapped);
    }
  });

  const mappedSections: MappedSection[] = sorted.map((section) => ({
    title: section.title,
    order: section.order,
    lessons: bySection.get(String((section as { _id?: unknown })._id ?? '')) ?? [],
  }));

  if (orphans.length > 0) {
    mappedSections.push({
      title: 'Divers',
      order: mappedSections.length,
      lessons: orphans,
    });
  }

  return {
    title: course.title,
    sections: mappedSections,
    lessonCount: lessons.length,
  };
}

/**
 * Retrouve la section (titre + position 0-based) contenant la leçon d'index
 * absolu donné, dans l'arbre mappé. Utile aux adapters pour publier une leçon
 * en connaissant son chapitre/section cible. Retourne null si introuvable.
 */
export function locateLesson(
  mapped: MappedCourse,
  index: number,
): { section: MappedSection; sectionPosition: number; positionInSection: number } | null {
  for (let s = 0; s < mapped.sections.length; s += 1) {
    const section = mapped.sections[s]!;
    const pos = section.lessons.findIndex((l) => l.index === index);
    if (pos !== -1) {
      return { section, sectionPosition: s, positionInSection: pos };
    }
  }
  return null;
}
