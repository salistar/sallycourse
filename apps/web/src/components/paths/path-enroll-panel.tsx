'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Award, Lock } from 'lucide-react';
import { Button, Card, CardContent, Progress, buttonVariants, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';

/**
 * Panneau d'inscription + progression d'un parcours (Prompt 199), côté client.
 * L'inscription passe par /api/paths/[id]/enroll : même chemin d'encaissement
 * que les cours (coupon + stub CMI) — un prix > 0 hors mode mock renvoie 402,
 * dont le message est affiché tel quel à l'apprenant.
 * La progression affichée est celle DÉRIVÉE des Enrollment (calculée côté
 * serveur) : aucun compteur n'est tenu ici.
 */

export interface PathEnrollPanelProps {
  pathId: string;
  isAuthenticated: boolean;
  enrolled: boolean;
  completed: boolean;
  percent: number;
  completedCourses: number;
  totalCourses: number;
  priceLabel: string;
  /** Libellé d'économie du bundle — absent si aucun gain (cours gratuits, etc.). */
  savingsLabel?: string;
  separateTotalLabel?: string;
}

export function PathEnrollPanel({
  pathId,
  isAuthenticated,
  enrolled,
  completed,
  percent,
  completedCourses,
  totalCourses,
  priceLabel,
  savingsLabel,
  separateTotalLabel,
}: PathEnrollPanelProps) {
  const t = useTranslations('paths');
  const tApiError = useTranslations('apiErrors');
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function enroll() {
    setPending(true);
    try {
      const response = await fetch(`/api/paths/${pathId}/enroll`, { method: 'POST' });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        toast({ variant: 'danger', title: errorMessage(data, tApiError) });
        return;
      }
      toast({ variant: 'success', title: t('enrolled') });
      router.refresh();
    } catch {
      toast({ variant: 'danger', title: t('enroll') });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl font-semibold text-foreground">{priceLabel}</p>
          {separateTotalLabel && <p className="text-xs text-muted line-through">{separateTotalLabel}</p>}
        </div>
        {savingsLabel && <p className="text-sm font-medium text-success">{savingsLabel}</p>}

        {enrolled ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{t('progress')}</span>
                <span className="font-medium text-foreground">
                  {t('progressValue', { completed: completedCourses, total: totalCourses })}
                </span>
              </div>
              <Progress value={percent} />
            </div>

            {completed ? (
              <a
                href={`/api/paths/${pathId}/certificate`}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: 'gold' }))}
              >
                <Award aria-hidden="true" /> {t('certificate')}
              </a>
            ) : (
              <p className="flex items-start gap-2 text-xs text-muted">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {t('certificateLocked')}
              </p>
            )}
          </div>
        ) : isAuthenticated ? (
          <Button onClick={enroll} loading={pending} disabled={pending}>
            {pending ? t('enrolling') : t('enroll')}
          </Button>
        ) : (
          <Link href="/login" className={cn(buttonVariants({ variant: 'primary' }))}>
            {t('loginToEnroll')}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
