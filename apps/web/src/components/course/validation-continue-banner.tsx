'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';
import type { SectionView } from './types';

/**
 * Bandeau du mode « validation étape par étape » (generationMode='validated') :
 * quand la dernière leçon générée est prête et qu'aucune autre n'est en cours,
 * invite l'auteur à la relire (elle est sélectionnable dans l'arborescence)
 * puis à cliquer « Valider et continuer » — ce qui enfile la leçon suivante
 * via POST /api/courses/[id]/continue-generation. En mode automatique, ce
 * bandeau n'est jamais rendu (chaînage worker inchangé).
 */
export interface ValidationContinueBannerProps {
  courseId: string;
  sections: SectionView[];
}

export function ValidationContinueBanner({ courseId, sections }: ValidationContinueBannerProps) {
  const router = useRouter();
  const t = useTranslations('course.validation');
  const tApiError = useTranslations('apiErrors');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const lessons = sections.flatMap((s) => s.lessons);
  const inFlight = lessons.some((l) => l.status === 'generating');
  const pendingCount = lessons.filter((l) => l.status === 'pending').length;
  const readyLessons = lessons.filter((l) => l.status === 'ready');
  const lastReady = readyLessons[readyLessons.length - 1];

  // Auto-rafraîchissement : les statuts viennent des props serveur, qui ne
  // bougent pas seules pendant la génération. Tant qu'une leçon tourne, on
  // rafraîchit périodiquement pour faire apparaître ce bandeau dès qu'elle est
  // prête (sinon il fallait un F5 manuel). S'arrête dès qu'aucune ne tourne.
  React.useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [inFlight, router]);

  // Rien à valider : une leçon tourne encore, ou tout est déjà généré.
  if (inFlight || pendingCount === 0 || !lastReady) return null;

  const handleContinue = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/continue-generation`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(errorMessage(body, tApiError));
        return;
      }
      router.refresh();
    } catch {
      setError(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label={t('sectionLabel')}
      className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t('lessonReady', { title: lastReady.title })}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {t('remaining', { count: pendingCount })}
          </p>
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
      </div>
      <Button variant="gold" onClick={handleContinue} loading={submitting} className="shrink-0">
        {submitting ? (
          <>
            <Loader2 aria-hidden="true" className="animate-spin" /> {t('launching')}
          </>
        ) : (
          t('validateContinue')
        )}
      </Button>
    </section>
  );
}
