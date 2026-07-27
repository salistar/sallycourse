'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Award,
  Flame,
  FlaskConical,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import { Card, CardContent, Progress, useToast } from '@/components/ui';
import { Confetti, CountUp } from '@/components/motion';
import { cn } from '@/lib/cn';
import { StreakReminderOptIn } from './streak-reminder-optin';
import type { GamificationAwardView, GamificationBadgeView, GamificationProfileView } from './types';

/**
 * HUD de gamification de l'apprenant (Prompt 200) : niveau + barre d'XP,
 * flamme de série quotidienne, badges (obtenus / à débloquer) et opt-in aux
 * rappels de série (in-app + Web Push).
 *
 * Le profil est chargé au montage (GET /api/learn/gamification) ; chaque gain
 * d'XP remonté par le player (`award`, renvoyé par /track à la PREMIÈRE
 * complétion d'une leçon) est appliqué localement — pas de re-fetch — et
 * déclenche les célébrations : Confetti au level-up ou au badge débloqué
 * (le composant respecte prefers-reduced-motion), toast détaillant l'XP.
 */

export interface GamificationHudProps {
  /** Dernier gain d'XP remonté par le player ; null tant que rien n'a été gagné. */
  award: GamificationAwardView | null;
  className?: string;
}

/** Icônes du catalogue de badges (clés définies dans @sallycourse/shared/gamification). */
const BADGE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  sparkles: Sparkles,
  flask: FlaskConical,
  target: Target,
  award: Award,
  flame: Flame,
  trophy: Trophy,
};

export function GamificationHud({ award, className }: GamificationHudProps) {
  const { toast } = useToast();
  const t = useTranslations('learn.gamification');
  const [profile, setProfile] = React.useState<GamificationProfileView | null>(null);
  const [previousXp, setPreviousXp] = React.useState(0);
  const [celebrate, setCelebrate] = React.useState(false);

  // Chargement initial du profil (best-effort : le HUD reste masqué en cas d'échec).
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/learn/gamification', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as GamificationProfileView;
        if (cancelled) return;
        setProfile(data);
        setPreviousXp(data.totalXp);
      } catch {
        /* best-effort : pas de HUD, le cours reste utilisable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Application du gain d'XP : mise à jour locale + célébrations.
  React.useEffect(() => {
    if (!award) return;

    setProfile((current) => {
      if (!current) return current;
      setPreviousXp(current.totalXp);
      const knownIds = new Set(current.badges.map((b) => b.id));
      const merged = [
        ...current.badges,
        ...award.newBadges.filter((b) => !knownIds.has(b.id)),
      ];
      return {
        ...current,
        totalXp: award.totalXp,
        level: award.level,
        levelProgress: award.levelProgress,
        currentStreak: award.streak.current,
        longestStreak: award.streak.longest,
        badges: merged,
      };
    });

    if (award.leveledUp || award.newBadges.length > 0) setCelebrate(true);

    const parts = [`+${award.xp.total} XP`];
    if (award.xp.dailyBonus > 0) parts.push(t('dailyBonus', { bonus: award.xp.dailyBonus }));
    toast({
      title: award.leveledUp ? t('levelUpTitle', { level: award.level }) : parts[0]!,
      description: award.leveledUp
        ? parts.join(' · ')
        : award.newBadges.length > 0
          ? t('badgeUnlocked', { badges: award.newBadges.map((b) => b.label).join(', ') })
          : parts.slice(1).join(' · ') || undefined,
      variant: 'success',
    });
  }, [award, toast]);

  if (!profile) return null;

  const earnedIds = new Set(profile.badges.map((b) => b.id));

  return (
    <>
      <Confetti active={celebrate} onComplete={() => setCelebrate(false)} />

      <Card className={className}>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-600 to-accent-400 font-display text-sm font-bold text-primary-foreground"
              >
                {profile.level}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">
                  {t('level', { level: profile.level })}
                </span>
                <span className="text-2xs text-muted">
                  <CountUp
                    value={profile.totalXp}
                    from={previousXp}
                    startOnView={false}
                    durationMs={800}
                    suffix=" XP"
                  />{' '}
                  {t('xpToNextLevel', {
                    remaining: profile.levelProgress.xpRemaining,
                    level: profile.level + 1,
                  })}
                </span>
              </div>
            </div>

            <div
              className="flex items-center gap-2"
              title={t('streakRecordTitle', { longest: profile.longestStreak })}
            >
              <Flame
                className={cn(
                  'size-5',
                  profile.currentStreak > 0 ? 'text-accent-400' : 'text-muted/50',
                )}
                aria-hidden="true"
              />
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {profile.currentStreak}
              </span>
              <span className="text-2xs text-muted">
                {t('streakDaysInARow', {
                  count: profile.currentStreak,
                  longest: profile.longestStreak,
                })}
              </span>
            </div>
          </div>

          <Progress
            value={profile.levelProgress.percent}
            label={t('levelProgressLabel', { level: profile.level + 1 })}
          />

          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {profile.catalogue.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} earned={earnedIds.has(badge.id)} />
            ))}
          </ul>

          <StreakReminderOptIn />
        </CardContent>
      </Card>
    </>
  );
}

/** Pastille de badge : coloré si obtenu, grisé sinon (le catalogue est public). */
function BadgeChip({ badge, earned }: { badge: GamificationBadgeView; earned: boolean }) {
  const Icon = BADGE_ICON[badge.icon] ?? Award;
  return (
    <li>
      <span
        title={`${badge.label} — ${badge.description}`}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium',
          earned
            ? 'border-accent-400/50 bg-accent-50/50 text-foreground'
            : 'border-border bg-surface-subtle text-muted opacity-60',
        )}
      >
        <Icon
          className={cn('size-3.5', earned ? 'text-accent-600' : 'text-muted')}
          aria-hidden="true"
        />
        {badge.label}
        {earned && <Zap className="size-3 text-accent-600" aria-hidden="true" />}
      </span>
    </li>
  );
}
