import { NextResponse } from 'next/server';
import {
  Course as CourseModel,
  Enrollment,
  LearningPath,
  LmsListing,
  type ILearningPath,
  type LmsCurrency,
} from '@sallycourse/db';
import {
  computePathProgress,
  slugifyPathTitle,
  type PathProgress,
} from '@sallycourse/shared/learning-path';

/**
 * I/O des parcours d'apprentissage (Prompt 199) — factorisée hors des routes :
 * garde d'ownership/publication des cours, création avec slug unique et
 * dérivation de la progression depuis les Enrollment EXISTANTS (aucun second
 * système de progression). La logique pure vit dans @sallycourse/shared/learning-path.
 */

/**
 * Vérifie que TOUS les cours appartiennent à l'utilisateur et sont publiés sur
 * le LMS interne. Renvoie une Response d'erreur, ou null si tout est conforme.
 * Ownership → 404 (jamais 403), convention du repo : ne pas révéler
 * l'existence des cours d'autrui.
 */
export async function assertOwnedAndPublished(
  courseIds: readonly string[],
  userId: string,
): Promise<Response | null> {
  const owned = await CourseModel.find({ _id: { $in: courseIds }, userId })
    .select('_id')
    .lean();
  if (owned.length !== courseIds.length) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const published = await LmsListing.countDocuments({
    courseId: { $in: courseIds },
    published: true,
  });
  if (published !== courseIds.length) {
    return NextResponse.json(
      { error: 'Chaque cours du parcours doit d’abord être publié sur le LMS interne.' },
      { status: 409 },
    );
  }
  return null;
}

export interface CreatePathInput {
  userId: string;
  title: string;
  description: string;
  courses: { courseId: string; order: number; requiresPrevious: boolean }[];
  priceCents: number;
  currency: LmsCurrency;
}

/**
 * Crée le parcours en garantissant l'unicité du slug : le slug dérivé du titre
 * peut déjà exister (ou être vide, si le titre n'a aucun caractère exploitable).
 * On retente alors avec un suffixe aléatoire — y compris sur collision
 * concurrente (erreur Mongo 11000 de l'index unique).
 */
export async function createPathWithUniqueSlug(input: CreatePathInput) {
  const base = slugifyPathTitle(input.title) || 'parcours';
  const suffixed = `${base}-${Math.random().toString(36).slice(2, 8)}`;
  const taken = await LearningPath.exists({ slug: base });

  try {
    return await LearningPath.create({ ...input, slug: taken ? suffixed : base });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return await LearningPath.create({ ...input, slug: suffixed });
  }
}

/** Cours du parcours triés par rang, ids en string (forme attendue par la logique pure). */
export function orderedPathCourses(path: Pick<ILearningPath, 'courses'>) {
  return [...path.courses]
    .sort((a, b) => a.order - b.order)
    .map((course) => ({
      courseId: String(course.courseId),
      order: course.order,
      requiresPrevious: course.requiresPrevious,
    }));
}

/**
 * Progression d'un apprenant sur un parcours, DÉRIVÉE des Enrollment existants
 * (leur `completedAt`) : rien n'est recalculé ni dupliqué. Renvoie aussi les
 * ids des cours terminés, dont dépendent les verrous de prérequis.
 */
export async function derivePathProgress(
  path: Pick<ILearningPath, 'courses'>,
  studentId: string,
): Promise<{ progress: PathProgress; completedIds: string[] }> {
  const courses = orderedPathCourses(path);
  const enrollments = await Enrollment.find({
    studentId,
    courseId: { $in: courses.map((course) => course.courseId) },
  })
    .select('courseId completedAt')
    .lean();

  const normalized = enrollments.map((enrollment) => ({
    courseId: String(enrollment.courseId),
    completedAt: enrollment.completedAt ?? null,
  }));

  return {
    progress: computePathProgress(courses, normalized),
    completedIds: normalized
      .filter((enrollment) => enrollment.completedAt)
      .map((enrollment) => enrollment.courseId),
  };
}
