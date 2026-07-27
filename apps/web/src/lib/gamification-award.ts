import {
  connectDb,
  CourseXp,
  Enrollment,
  GamificationProfile,
  Lesson,
  LessonProgress,
  notify,
  type IEarnedBadge,
} from '@sallycourse/db';
import {
  evaluateBadges,
  findBadge,
  levelForXp,
  updateStreak,
  xpForLessonEvent,
  xpToNextLevel,
  type BadgeId,
  type LevelProgress,
} from '@sallycourse/shared/gamification';
import type { LessonType } from '@sallycourse/shared/schemas/course';

/**
 * Orchestrateur I/O de la gamification (Prompt 200) — appelé par
 * POST /api/learn/[courseId]/track quand une leçon est terminée pour la
 * PREMIÈRE fois (la route détecte la première complétion via
 * findOneAndUpdate({ returnDocument: 'before' }) : re-visionner une leçon ne
 * redonne jamais d'XP).
 *
 * Toute la logique de calcul (barème, niveaux, streak, badges) vit dans
 * @sallycourse/shared/gamification (pur, testé) ; ici, uniquement de l'I/O :
 * lecture/écriture du profil, XP par cours, notifications in-app.
 *
 * Best-effort : ne jette jamais. Un échec de gamification ne doit pas faire
 * échouer l'enregistrement de la progression de l'apprenant.
 */

export interface AwardedBadge {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export interface GamificationAward {
  /** Détail de l'XP gagné à cet événement. */
  xp: { lesson: number; quiz: number; dailyBonus: number; total: number };
  /** XP cumulé après attribution. */
  totalXp: number;
  /** XP cumulé sur CE cours après attribution. */
  courseXp: number;
  level: number;
  previousLevel: number;
  leveledUp: boolean;
  /** Progression vers le niveau suivant (barre XP). */
  levelProgress: LevelProgress;
  streak: {
    current: number;
    longest: number;
    /** true si la série s'allonge aujourd'hui (première activité du jour). */
    extended: boolean;
    /** true si la série précédente a été rompue par un jour sauté. */
    broken: boolean;
  };
  /** Badges débloqués par cet événement (vide la plupart du temps). */
  newBadges: AwardedBadge[];
}

export interface AwardLessonInput {
  userId: string;
  courseId: string;
  lessonId: string;
  /** Type de la leçon terminée (le badge « premier TP » en dépend). */
  lessonType: LessonType;
  /** Score du quiz (0–100) si la leçon est un quiz. */
  quizScore?: number;
  /** Injectable pour les tests / rejouabilité ; défaut : maintenant. */
  now?: Date;
}

/** Convertit un id de badge en vue UI (label/description/icône du catalogue). */
function toAwardedBadge(id: BadgeId): AwardedBadge {
  const def = findBadge(id);
  return {
    id,
    label: def?.label ?? id,
    description: def?.description ?? '',
    icon: def?.icon ?? 'award',
  };
}

/**
 * Attribue l'XP d'une leçon terminée (première complétion), met à jour le
 * streak quotidien (jour UTC), le niveau, les badges et l'XP du cours.
 * Retourne le delta à afficher au client, ou `null` si rien n'a pu être
 * attribué (erreur — best-effort).
 */
export async function awardForLessonCompletion(
  input: AwardLessonInput,
): Promise<GamificationAward | null> {
  const now = input.now ?? new Date();

  try {
    await connectDb();

    // Profil créé à la volée à la première leçon terminée (upsert atomique).
    const profile = await GamificationProfile.findOneAndUpdate(
      { userId: input.userId },
      { $setOnInsert: { userId: input.userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // 1) Streak (jour UTC) — le bonus « première leçon du jour » en découle.
    const streak = updateStreak(
      {
        currentStreak: profile.currentStreak,
        longestStreak: profile.longestStreak,
        lastActiveDay: profile.lastActiveDay ?? null,
      },
      now,
    );

    // 2) XP de l'événement (leçon + quiz + bonus quotidien).
    const xp = xpForLessonEvent({ quizScore: input.quizScore, firstOfDay: streak.firstOfDay });

    const previousLevel = profile.level;
    const totalXp = profile.totalXp + xp.total;
    const level = levelForXp(totalXp);

    // 3) État servant à l'évaluation des badges (comptages réels, pas de cache).
    const completedRows = await LessonProgress.find({
      studentId: input.userId,
      completedAt: { $ne: null },
    })
      .select('lessonId quizScore')
      .lean();

    const completedLessonIds = completedRows.map((row) => row.lessonId);
    const [tpCompleted, coursesCompleted] = await Promise.all([
      Lesson.countDocuments({ _id: { $in: completedLessonIds }, type: 'tp' }),
      Enrollment.countDocuments({ studentId: input.userId, completedAt: { $ne: null } }),
    ]);

    const earnedIds = profile.badges.map((b) => b.id);
    const newBadgeIds = evaluateBadges({
      earned: earnedIds,
      lessonsCompleted: completedRows.length,
      tpCompleted: input.lessonType === 'tp' ? Math.max(1, tpCompleted) : tpCompleted,
      hasPerfectQuiz:
        input.quizScore === 100 || completedRows.some((row) => row.quizScore === 100),
      coursesCompleted,
      currentStreak: streak.current,
    });

    const newBadges: IEarnedBadge[] = newBadgeIds.map((id) => ({ id, earnedAt: now }));

    // 4) Persistance du profil (une seule écriture) + XP du cours.
    profile.set({
      totalXp,
      level,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      lastActiveDay: streak.day,
      badges: [...profile.badges, ...newBadges],
    });
    await profile.save();

    const courseXpDoc = await CourseXp.findOneAndUpdate(
      { studentId: input.userId, courseId: input.courseId },
      { $inc: { xp: xp.total }, $setOnInsert: { studentId: input.userId, courseId: input.courseId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const leveledUp = level > previousLevel;

    // 5) Notifications in-app (best-effort, jamais bloquantes — pas d'email :
    //    EMAIL_TEMPLATE_BY_TYPE mappe ces types sur `undefined`).
    const link = `/learn/${input.courseId}`;
    await Promise.all([
      ...newBadgeIds.map(async (id) => {
        const badge = toAwardedBadge(id);
        await notify(input.userId, {
          type: 'badge_earned',
          title: `Badge débloqué : ${badge.label}`,
          body: badge.description,
          link,
        }).catch(() => undefined);
      }),
      leveledUp
        ? notify(input.userId, {
            type: 'level_up',
            title: `Niveau ${level} atteint !`,
            body: `Vous cumulez ${totalXp} XP. Continuez sur votre lancée.`,
            link,
          }).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);

    return {
      xp,
      totalXp,
      courseXp: courseXpDoc?.xp ?? xp.total,
      level,
      previousLevel,
      leveledUp,
      levelProgress: xpToNextLevel(totalXp),
      streak: {
        current: streak.current,
        longest: streak.longest,
        extended: streak.firstOfDay,
        broken: streak.broken,
      },
      newBadges: newBadgeIds.map(toAwardedBadge),
    };
  } catch (err) {
    // Best-effort : la progression de l'apprenant a déjà été enregistrée par la
    // route ; la gamification ne doit jamais la faire échouer.
    console.warn('[gamification] attribution impossible :', err);
    return null;
  }
}
