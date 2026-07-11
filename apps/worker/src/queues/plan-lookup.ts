// Résolution du plan d'abonnement du propriétaire d'un cours (P73) — utilisé
// pour propager la priorité BullMQ (priorityForPlan) lors des ré-enfilages en
// chaîne du pipeline (une leçon qui enfile la suivante, tts → video-render,
// video-render → subtitle…). Best-effort : Mongo indisponible ou cours/2
// utilisateur introuvable → repli 'free' (aucun passe-droit implicite).
import { Course, User } from '../shared.js';
import { logger } from './index.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { type PlanId } from '@sallycourse/shared';

/** Plan de l'utilisateur propriétaire du cours, 'free' par défaut (best-effort). */
export async function planForCourse(courseId: string): Promise<PlanId> {
  try {
    const course = await Course.findById(courseId).select('userId').lean();
    if (!course) return 'free';
    const user = await User.findById(course.userId).select('plan').lean();
    return (user?.plan as PlanId | undefined) ?? 'free';
  } catch (err) {
    logger.warn({ courseId, err }, 'résolution du plan impossible — repli free');
    return 'free';
  }
}
