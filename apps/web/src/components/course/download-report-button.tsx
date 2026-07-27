'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePollForArtifact } from './use-poll-for-artifact';

/**
 * « Télécharger le rapport » (P50) — enfile la génération du rapport de
 * déploiement (POST) puis sonde (GET) via {@link usePollForArtifact} jusqu'à
 * disponibilité du PDF, avant de basculer en lien présigné. Au montage, une
 * vérification silencieuse propose directement le lien si un rapport existe déjà.
 */
export interface DownloadReportButtonProps {
  courseId: string;
}

export function DownloadReportButton({ courseId }: DownloadReportButtonProps) {
  const t = useTranslations('course.download');
  const { phase, url, building, build } = usePollForArtifact({
    courseId,
    path: 'deployments/report',
    sub: 'report',
    maxPolls: 20,
  });

  if (phase === 'ready' && url) {
    return (
      <a href={url} download className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
        <FileText aria-hidden="true" />
        {t('report.linkLabel')}
      </a>
    );
  }

  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <FileText aria-hidden="true" />}
      {building ? t('report.building') : t('report.idleLabel')}
    </Button>
  );
}
