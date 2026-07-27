import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, CourseXp, Enrollment, GamificationProfile, User } from '@sallycourse/db';
import { rankLeaderboard, type LeaderboardEntryInput } from '@sallycourse/shared/gamification';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/learn/[courseId]/leaderboard — classement XP d'un cours (Prompt 200).
 * Réservé aux apprenants INSCRITS au cours. Renvoie le top 20 et, si
 * l'apprenant courant n'y figure pas, sa propre ligne (rang réel calculé sur
 * l'ensemble des participants).
 *
 * Vie privée : jamais d'email — le libellé public est « Prénom I. »
 * (leaderboardDisplayName). Un apprenant ayant activé `leaderboardOptOut`
 * apparaît sous « Apprenant » (il reste classé, mais anonymisé).
 */

export const dynamic = 'force-dynamic';

const TOP_SIZE = 20;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return apiError('courseNotFound');
  }

  await connectDb();

  const enrollment = await Enrollment.findOne({ studentId: user.id, courseId }).select('_id').lean();
  if (!enrollment) {
    return apiError('enrollmentRequired');
  }

  // Toutes les lignes du cours (index (courseId, xp desc)) : le rang de
  // l'apprenant courant doit rester exact même hors du top 20.
  const rows = await CourseXp.find({ courseId }).select('studentId xp').sort({ xp: -1 }).lean();

  const studentIds = rows.map((row) => row.studentId);
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: studentIds } }).select('name').lean(),
    GamificationProfile.find({ userId: { $in: studentIds } })
      .select('userId leaderboardOptOut')
      .lean(),
  ]);

  const nameById = new Map(users.map((u) => [String(u._id), u.name]));
  const optOutById = new Map(profiles.map((p) => [String(p.userId), p.leaderboardOptOut]));

  const entries: LeaderboardEntryInput[] = rows.map((row) => {
    const studentId = String(row.studentId);
    return {
      studentId,
      xp: row.xp,
      name: nameById.get(studentId) ?? null,
      optOut: optOutById.get(studentId) ?? false,
    };
  });

  const ranked = rankLeaderboard(entries, user.id);
  const top = ranked.slice(0, TOP_SIZE);
  const viewerRow = ranked.find((r) => r.isViewer) ?? null;

  return NextResponse.json({
    total: ranked.length,
    top,
    // null si l'apprenant n'a pas encore gagné d'XP sur ce cours ; sinon sa
    // ligne (déjà présente dans `top` s'il y figure — le client dédoublonne).
    viewer: viewerRow,
  });
}
