import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { connectDb, GamificationProfile } from '@sallycourse/db';
import { BADGES, findBadge, xpToNextLevel } from '@sallycourse/shared/gamification';
import { requireApiUser } from '@/lib/session';

/**
 * /api/learn/gamification — profil de gamification de l'apprenant connecté
 * (Prompt 200).
 *  - GET   : XP, niveau + progression, streak, badges obtenus (enrichis du
 *            catalogue partagé) et catalogue complet (badges à débloquer).
 *  - PATCH : opt-out du classement (`leaderboardOptOut`) — l'apprenant reste
 *            classé mais s'affiche sous « Apprenant ».
 *
 * Aucun profil en base tant qu'aucune leçon n'a été terminée : le GET renvoie
 * alors un profil neutre (niveau 1, 0 XP) sans rien créer.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();

  const profile = await GamificationProfile.findOne({ userId: user.id }).lean();

  const totalXp = profile?.totalXp ?? 0;
  const badges = (profile?.badges ?? []).map((b) => {
    const def = findBadge(b.id);
    return {
      id: b.id,
      label: def?.label ?? b.id,
      description: def?.description ?? '',
      icon: def?.icon ?? 'award',
      earnedAt: new Date(b.earnedAt).toISOString(),
    };
  });

  return NextResponse.json({
    totalXp,
    level: profile?.level ?? 1,
    levelProgress: xpToNextLevel(totalXp),
    currentStreak: profile?.currentStreak ?? 0,
    longestStreak: profile?.longestStreak ?? 0,
    lastActiveDay: profile?.lastActiveDay ?? null,
    leaderboardOptOut: profile?.leaderboardOptOut ?? false,
    badges,
    // Catalogue complet : l'UI grise les badges non encore obtenus.
    catalogue: BADGES.map((b) => ({
      id: b.id,
      label: b.label,
      description: b.description,
      icon: b.icon,
    })),
  });
}

const patchSchema = z.object({
  leaderboardOptOut: z.boolean(),
});

export async function PATCH(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('invalidRequest');
  }

  await connectDb();

  const profile = await GamificationProfile.findOneAndUpdate(
    { userId: user.id },
    {
      $set: { leaderboardOptOut: parsed.data.leaderboardOptOut },
      $setOnInsert: { userId: user.id },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return NextResponse.json({ leaderboardOptOut: profile.leaderboardOptOut });
}
