// Annulation propre d'une génération en cours (P73). POST /api/courses/[id]/cancel
// marque Course.status='cancelled' ; ce module fournit checkCancelled(courseId),
// appelé par les processors ENTRE deux étapes longues (boucle de rendu vidéo,
// synthèse TTS slide par slide…) pour s'arrêter proprement dès que possible —
// sans attendre la fin du job BullMQ. Ne remplace PAS un vrai kill mid-ffmpeg :
// le process ffmpeg déjà lancé pour LA slide courante va à son terme (quelques
// secondes), seule la PROCHAINE itération est court-circuitée.
import { Course } from '../shared.js';
import { logger } from '../queues/index.js';

/** Jetée par checkCancelled quand le cours a été annulé — à laisser remonter (pas de retry BullMQ utile). */
export class CourseCancelledError extends Error {
  constructor(public readonly courseId: string) {
    super(`génération annulée par l'utilisateur (cours ${courseId})`);
    this.name = 'CourseCancelledError';
  }
}

/**
 * Vérifie si le cours a été annulé (statut 'cancelled') et jette
 * CourseCancelledError si c'est le cas — à appeler entre chaque item d'une
 * boucle longue (slide TTS, segment vidéo…). Best-effort côté lecture : une
 * erreur Mongo n'interrompt PAS le job en cours (on continue optimistiquement),
 * seule une lecture réussie confirmant 'cancelled' arrête le traitement.
 */
export async function checkCancelled(courseId: string): Promise<void> {
  try {
    const course = await Course.findById(courseId).select('status').lean();
    if (course?.status === 'cancelled') {
      throw new CourseCancelledError(courseId);
    }
  } catch (err) {
    if (err instanceof CourseCancelledError) throw err;
    logger.warn({ courseId, err }, 'vérification d\'annulation impossible — poursuite optimiste');
  }
}

/** Sous-ensemble minimal du ResultPromise execa utilisé ici (évite de dépendre du type exact execa). */
export interface KillableChild {
  kill: (...args: never[]) => boolean;
}

/**
 * Tue un process execa actif (ex. ffmpeg en cours) si l'annulation est
 * détectée pendant son exécution — best-effort, ne jette jamais. `child` est
 * le ResultPromise retourné par execa(...) (expose .kill()).
 */
export function killIfActive(child: KillableChild | undefined | null): void {
  try {
    // Cast : les overloads execa acceptent kill(signal) et kill(error), le
    // signal générique 'SIGTERM' est valide dans les deux cas à l'exécution.
    (child?.kill as ((signal: string) => boolean) | undefined)?.('SIGTERM');
  } catch (err) {
    logger.warn({ err }, 'arrêt du process ffmpeg impossible (best-effort)');
  }
}
