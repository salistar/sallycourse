import {
  COURSE_CREATE_DEDUPE_WINDOW_SEC,
  PLANS,
  QUEUES,
  computeNextOffPeakDelayMs,
  defaultJobOptions,
  makeJobId,
  priorityForPlan,
  type CreateCourseInput,
  type PlanId,
} from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  GenerationJob as GenerationJobModel,
  notify,
} from '@sallycourse/db';
import { getOutlineQueue } from './queues';
import { checkAndReserveCourseQuota, releaseQuota } from './quota';
import { findMostSimilarTitle } from './title-similarity';

/** Libellés de plan lisibles pour la notification de quota. */
const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Gratuit',
  pro: 'Pro',
  business: 'Business',
};

/**
 * Logique métier partagée de création de cours (quota mensuel → Course →
 * GenerationJob → enqueue outline). Extraite de /api/courses pour être
 * réutilisée telle quelle par l'API publique v1 (Prompt 51), garantissant un
 * comportement identique (quotas, jobId déterministe) quel que soit le point
 * d'entrée. La logique de quota vit dans lib/quota.ts (helper central, P53).
 */

export type CreateCourseError =
  | { kind: 'quota'; limit: number; plan: string }
  | { kind: 'user_not_found' }
  | { kind: 'create_failed' }
  | { kind: 'enqueue_failed' };

export type CreateCourseResult =
  | {
      ok: true;
      id: string;
      title: string;
      status: string;
      /**
       * Avertissement de similarité (P115) : un cours existant de l'utilisateur
       * a un titre très proche (Jaccard n-grams >= seuil). Informatif seulement
       * — ne bloque jamais la création, laissé à l'appelant (UI) d'afficher.
       */
      similarityWarning?: { courseTitle: string; score: number };
      /**
       * Vrai si ce résultat est un cours DÉJÀ créé (double-clic détecté, P120) —
       * aucun nouveau crédit de quota consommé, aucun nouveau job enfilé.
       */
      deduped?: boolean;
      /**
       * Programmation en heures creuses (P134) : instant ISO auquel le job
       * outline démarrera réellement. Présent uniquement si scheduleOffPeak
       * était coché ET que ce n'est pas déjà l'heure creuse (délai > 0).
       */
      scheduledFor?: string;
    }
  | { ok: false; error: CreateCourseError };

/** Normalise un titre pour la comparaison exacte anti-double-clic (trim + casse). */
function normalizeExactTitle(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Crée un cours pour un utilisateur et enfile la génération. Applique le quota
 * du plan (réservation atomique) et rend le crédit en cas d'échec. Retourne un
 * résultat typé — le mapping vers un status HTTP est laissé à l'appelant.
 */
export async function createCourseForUser(
  userId: string,
  plan: PlanId,
  input: CreateCourseInput,
  options?: {
    /**
     * Délai (ms) avant traitement du job outline par le worker. Utilisé par la
     * génération en batch (P63) pour échelonner les enqueues : la queue gère
     * déjà la concurrence, mais espacer les démarrages lisse la charge vidéo.
     */
    enqueueDelayMs?: number;
    /**
     * Mode agence (P150) : rattache le cours créé à ce client d'agence — le
     * userId reste celui de l'agence (quota/facturation), seuls les
     * déploiements basculeront sur les credentials du client (voir
     * resolveAgencyDeployCredentials côté worker). Additif, absent = cours
     * normal.
     */
    agencyClientId?: string;
  },
): Promise<CreateCourseResult> {
  await connectDb();

  // Anti-double-clic (P120) : un second POST avec le MÊME titre (exact, trim +
  // casse insensible) pour cet utilisateur dans les COURSE_CREATE_DEDUPE_WINDOW_SEC
  // dernières secondes est traité comme un doublon de soumission — on renvoie le
  // cours déjà créé sans consommer de second crédit ni enfiler un second pipeline.
  // Vérifié AVANT la réservation de quota pour ne jamais bloquer un crédit inutile.
  const dedupeSince = new Date(Date.now() - COURSE_CREATE_DEDUPE_WINDOW_SEC * 1000);
  const recentCandidates = await CourseModel.find({ userId, createdAt: { $gte: dedupeSince } })
    .select('title status createdAt')
    .sort({ createdAt: -1 })
    .lean();
  const normalizedInputTitle = normalizeExactTitle(input.title);
  const duplicate = recentCandidates.find(
    (c) => normalizeExactTitle(c.title) === normalizedInputTitle,
  );
  if (duplicate) {
    return {
      ok: true,
      id: String(duplicate._id),
      title: duplicate.title,
      status: duplicate.status,
      deduped: true,
    };
  }

  // Réservation atomique du crédit mensuel via le helper central (P53).
  const reservation = await checkAndReserveCourseQuota(userId);
  if (!reservation.ok) {
    if (reservation.reason === 'user_not_found') {
      return { ok: false, error: { kind: 'user_not_found' } };
    }
    // Notification (P59) — quota mensuel atteint (in-app + email best-effort).
    // Ne bloque pas la réponse d'erreur ; échec de notif ignoré.
    try {
      const planLabel = PLAN_LABELS[reservation.plan];
      await notify(userId, {
        type: 'quota_reached',
        title: 'Quota mensuel atteint',
        body: `Vous avez atteint la limite de ${reservation.limit} cours/mois du plan ${planLabel}.`,
        link: '/pricing',
        emailData: { plan: planLabel, actionUrl: '/pricing', actionLabel: 'Voir les offres' },
      });
    } catch {
      /* best-effort */
    }
    return {
      ok: false,
      error: { kind: 'quota', limit: reservation.limit, plan: reservation.plan },
    };
  }

  // Filigrane exigé selon le plan (free=true) — appliqué à la création (P53).
  const watermark = PLANS[plan].watermark;

  // Déduplication (P115) : avertissement si un cours très similaire de cet
  // utilisateur existe déjà (titre). Informatif seulement, best-effort — ne
  // bloque jamais la création même si la vérification échoue.
  let similarityWarning: { courseTitle: string; score: number } | undefined;
  try {
    const existing = await CourseModel.find({ userId }).select('title').lean();
    const match = findMostSimilarTitle(
      input.title,
      existing.map((c) => c.title),
    );
    if (match) similarityWarning = { courseTitle: match.title, score: match.score };
  } catch {
    /* best-effort : une vérification ratée ne bloque jamais la création */
  }

  let course;
  try {
    course = await CourseModel.create({
      userId,
      title: input.title,
      difficulty: input.difficulty,
      locale: input.locale,
      ttsVoice: input.ttsVoice,
      targetPlatforms: input.targetPlatforms,
      watermark,
      status: 'generating',
      avatarEnabled: input.avatarEnabled,
      avatarId: input.avatarId,
      ...(options?.agencyClientId ? { agencyClientId: options.agencyClientId } : {}),
    });
  } catch {
    // La création a échoué après réservation : on rend le crédit.
    await releaseQuota(userId);
    return { ok: false, error: { kind: 'create_failed' } };
  }

  const courseId = course._id.toString();

  // Programmation en heures creuses (P134) : si l'utilisateur a coché
  // l'option, le délai jusqu'à la prochaine fenêtre creuse (2h-6h) remplace
  // le délai d'échelonnement (P63) plutôt que de s'y additionner — les deux
  // sont des délais de démarrage exclusifs, on prend le plus contraignant.
  const offPeakDelayMs = input.scheduleOffPeak ? computeNextOffPeakDelayMs(new Date()) : 0;
  const enqueueDelayMs = Math.max(options?.enqueueDelayMs ?? 0, offPeakDelayMs);

  try {
    await GenerationJobModel.create({
      courseId: course._id,
      step: QUEUES.outline,
      progress: 0,
    });
    await getOutlineQueue().add(
      'outline',
      { courseId },
      {
        ...defaultJobOptions,
        jobId: makeJobId(courseId, QUEUES.outline),
        // Priorité BullMQ selon le plan (P73) — business/pro passent devant free.
        priority: priorityForPlan(plan),
        // Délai optionnel : échelonnement des lots (P63) ou programmation nocturne (P134).
        ...(enqueueDelayMs ? { delay: enqueueDelayMs } : {}),
      },
    );
  } catch (err) {
    console.error('[create-course] enqueue failed:', err);
    // Le crédit a été réservé plus haut : une génération qui échoue avant même
    // de démarrer ne doit pas coûter le quota mensuel de l'utilisateur.
    await releaseQuota(userId);
    await CourseModel.updateOne({ _id: course._id }, { $set: { status: 'failed' } }).catch(
      () => undefined,
    );
    return { ok: false, error: { kind: 'enqueue_failed' } };
  }

  return {
    ok: true,
    id: courseId,
    title: course.title,
    status: course.status,
    ...(similarityWarning ? { similarityWarning } : {}),
    ...(offPeakDelayMs > 0
      ? { scheduledFor: new Date(Date.now() + offPeakDelayMs).toISOString() }
      : {}),
  };
}
