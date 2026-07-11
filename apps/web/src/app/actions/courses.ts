'use server';

import { revalidatePath } from 'next/cache';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  connectDb,
  Course,
  Deployment,
  GenerationJob,
  Lesson,
  Quiz,
  Section,
  Testimonial,
} from '@sallycourse/db';
import { auth } from '@/lib/auth';

/**
 * Actions serveur des cours — suppression (cascade) et renommage.
 * Chaque action revérifie la session ET la propriété du cours : les actions
 * sont appelables depuis n'importe quel client, on ne fait confiance à rien.
 */

export type CourseActionResult = { ok: true } | { ok: false; error: string };

/** Titre aligné sur createCourseInputSchema (3–120 caractères). */
const titleSchema = z.string().trim().min(3, 'Titre trop court (3 caractères minimum).').max(120, 'Titre trop long (120 caractères maximum).');

/** Retourne l'id utilisateur connecté, ou null si session absente. */
async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Supprime un cours et tout son contenu dérivé (sections, leçons, quiz,
 * jobs de génération, déploiements).
 */
export async function deleteCourse(courseId: string): Promise<CourseActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Authentification requise.' };
  if (!Types.ObjectId.isValid(courseId)) return { ok: false, error: 'Identifiant de cours invalide.' };

  try {
    await connectDb();

    // Propriété : le cours doit appartenir à l'utilisateur connecté.
    const course = await Course.findOne({ _id: courseId, userId }).select('_id').lean();
    if (!course) return { ok: false, error: 'Cours introuvable.' };

    // Cascade : tout le contenu dérivé référence courseId.
    await Promise.all([
      Section.deleteMany({ courseId }),
      Lesson.deleteMany({ courseId }),
      Quiz.deleteMany({ courseId }),
      GenerationJob.deleteMany({ courseId }),
      Deployment.deleteMany({ courseId }),
    ]);
    await Course.deleteOne({ _id: courseId, userId });

    // TODO(storage) : purger les assets S3/MinIO du préfixe du cours
    // (deleteCoursePrefix côté worker) quand le pipeline d'assets sera branché.

    revalidatePath('/dashboard');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Suppression impossible pour le moment. Réessayez.' };
  }
}

/** Renomme un cours (titre validé, propriété vérifiée). */
export async function renameCourse(courseId: string, title: string): Promise<CourseActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Authentification requise.' };
  if (!Types.ObjectId.isValid(courseId)) return { ok: false, error: 'Identifiant de cours invalide.' };

  const parsed = titleSchema.safeParse(title);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Titre invalide.' };
  }

  try {
    await connectDb();
    const updated = await Course.findOneAndUpdate(
      { _id: courseId, userId },
      { $set: { title: parsed.data } },
      { new: true },
    )
      .select('_id')
      .lean();
    if (!updated) return { ok: false, error: 'Cours introuvable.' };

    revalidatePath('/dashboard');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Renommage impossible pour le moment. Réessayez.' };
  }
}

const testimonialQuoteSchema = z.string().trim().min(10, 'Trop court (10 caractères minimum).').max(600, 'Trop long (600 caractères maximum).');

/**
 * Active/désactive l'affichage d'un cours sur la vitrine publique /showcase
 * (Prompt 89). Propriété vérifiée comme les autres actions de ce fichier.
 * Optionnel : témoignage joint (citation + note), remplacé si déjà existant.
 */
export async function setShowcaseOptIn(
  courseId: string,
  optIn: boolean,
  testimonial?: { quote: string; rating?: number },
): Promise<CourseActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Authentification requise.' };
  if (!Types.ObjectId.isValid(courseId)) return { ok: false, error: 'Identifiant de cours invalide.' };

  try {
    await connectDb();
    const course = await Course.findOneAndUpdate(
      { _id: courseId, userId },
      { $set: { showcaseOptIn: optIn } },
      { new: true },
    )
      .select('_id')
      .lean();
    if (!course) return { ok: false, error: 'Cours introuvable.' };

    if (optIn && testimonial?.quote) {
      const parsed = testimonialQuoteSchema.safeParse(testimonial.quote);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'Témoignage invalide.' };
      }
      const rating =
        typeof testimonial.rating === 'number' && testimonial.rating >= 1 && testimonial.rating <= 5
          ? Math.round(testimonial.rating)
          : undefined;
      await Testimonial.findOneAndUpdate(
        { courseId },
        { $set: { userId, courseId, quote: parsed.data, ...(rating ? { rating } : {}) } },
        { upsert: true },
      );
    } else if (!optIn) {
      // Retrait de la vitrine : le témoignage associé n'a plus lieu d'être public.
      await Testimonial.deleteOne({ courseId });
    }

    revalidatePath('/showcase');
    revalidatePath(`/dashboard/courses/${courseId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Mise à jour impossible pour le moment. Réessayez.' };
  }
}
