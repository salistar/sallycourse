'use client';

import { HardDriveDownload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePollForArtifact } from './use-poll-for-artifact';

/**
 * « Exporter en mode portable » (Prompt 142) — enfile un job packaging (POST)
 * puis sonde (GET) via {@link usePollForArtifact}. Cible /portable-export :
 * mini-site HTML/CSS/JS autonome utilisable hors ligne depuis une clé USB
 * (aucun serveur requis, protocole file://).
 */
export interface DownloadPortableButtonProps {
  courseId: string;
}

export function DownloadPortableButton({ courseId }: DownloadPortableButtonProps) {
  const t = useTranslations('course.download');
  const { phase, url, building, build } = usePollForArtifact({ courseId, path: 'portable-export', sub: 'portable' });

  if (phase === 'ready' && url) {
    return (
      <a href={url} download className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
        <HardDriveDownload aria-hidden="true" />
        {t('portable.linkLabel')}
      </a>
    );
  }

  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <HardDriveDownload aria-hidden="true" />}
      {building ? t('portable.building') : t('portable.idleLabel')}
    </Button>
  );
}
