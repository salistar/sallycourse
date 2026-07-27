'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Crown, EyeOff, Medal, Trophy } from 'lucide-react';
import { Button, Card, CardContent, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { LeaderboardRowView } from './types';

/**
 * Classement XP d'un cours (Prompt 200) — top 20 + la ligne de l'apprenant
 * courant si elle est hors du top. Les libellés viennent du serveur
 * (« Prénom I. », jamais l'email) ; l'opt-out anonymise en « Apprenant » et se
 * pilote depuis ce même bloc (PATCH /api/learn/gamification).
 *
 * `refreshToken` : incrémenté par le player à chaque gain d'XP → recharge le
 * classement sans re-monter le composant.
 */

export interface CourseLeaderboardProps {
  courseId: string;
  /** Change de valeur à chaque gain d'XP pour déclencher un rechargement. */
  refreshToken?: number;
  className?: string;
}

interface LeaderboardResponse {
  total: number;
  top: LeaderboardRowView[];
  viewer: LeaderboardRowView | null;
}

/** Médaille des trois premières places, numéro ensuite. */
function RankMark({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="size-4 text-accent-400" aria-hidden="true" />;
  if (rank === 2 || rank === 3)
    return <Medal className="size-4 text-muted" aria-hidden="true" />;
  return <span className="w-4 text-center text-2xs tabular-nums text-muted">{rank}</span>;
}

export function CourseLeaderboard({ courseId, refreshToken = 0, className }: CourseLeaderboardProps) {
  const t = useTranslations('learn.leaderboard');
  const { toast } = useToast();
  const [data, setData] = React.useState<LeaderboardResponse | null>(null);
  const [optOut, setOptOut] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [boardRes, profileRes] = await Promise.all([
        fetch(`/api/learn/${courseId}/leaderboard`, { cache: 'no-store' }),
        fetch('/api/learn/gamification', { cache: 'no-store' }),
      ]);
      if (boardRes.ok) setData((await boardRes.json()) as LeaderboardResponse);
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as { leaderboardOptOut: boolean };
        setOptOut(profile.leaderboardOptOut);
      }
    } catch {
      /* best-effort : pas de classement affiché */
    }
  }, [courseId]);

  React.useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function toggleOptOut() {
    if (optOut === null) return;
    const next = !optOut;
    setBusy(true);
    try {
      const res = await fetch('/api/learn/gamification', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leaderboardOptOut: next }),
      });
      if (!res.ok) throw new Error('optout');
      setOptOut(next);
      await load();
      toast({
        title: next ? t('toastAnonymized') : t('toastNameShown'),
        variant: 'success',
      });
    } catch {
      toast({ title: t('toastError'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  const rows = [...data.top];
  // L'apprenant hors du top 20 est ajouté en pied de liste (rang réel).
  const viewerOutside = data.viewer && !rows.some((r) => r.isViewer) ? data.viewer : null;

  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Trophy className="size-4 text-accent-400" aria-hidden="true" />
            {t('title')}
            <span className="font-normal text-muted">{t('count', { count: data.total })}</span>
          </p>
          {optOut !== null && (
            <Button variant="ghost" size="sm" onClick={toggleOptOut} disabled={busy}>
              <EyeOff aria-hidden="true" />
              {optOut ? t('showMyFirstName') : t('hideMyName')}
            </Button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            {t('empty')}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {[...rows, ...(viewerOutside ? [viewerOutside] : [])].map((row) => (
              <li
                key={row.studentId}
                className={cn(
                  'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm',
                  row.isViewer ? 'bg-primary-soft/60 font-medium text-foreground' : 'text-muted',
                  viewerOutside && row.studentId === viewerOutside.studentId && 'mt-2 border-t border-border pt-3',
                )}
              >
                <RankMark rank={row.rank} />
                <span className="min-w-0 flex-1 truncate">
                  {row.displayName}
                  {row.isViewer && <span className="ms-1.5 text-2xs text-muted">{t('you')}</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">
                  {row.xp} XP
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
