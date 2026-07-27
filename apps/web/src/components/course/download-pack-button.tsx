'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePollForArtifact } from './use-poll-for-artifact';

/**
 * « Télécharger le pack » — enfile un job packaging (POST) puis sonde (GET)
 * jusqu'à disponibilité du ZIP via {@link usePollForArtifact}, avant de basculer
 * en lien de téléchargement présigné. Au montage, une vérification silencieuse
 * propose directement le lien si un pack existe déjà.
 */
export interface DownloadPackButtonProps {
  courseId: string;
}

export function DownloadPackButton({ courseId }: DownloadPackButtonProps) {
  const t = useTranslations('course.download');
  const { phase, url, building, build } = usePollForArtifact({ courseId, path: 'package', sub: 'pack' });

  if (phase === 'ready' && url) {
    return (
      <a href={url} download className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
        <Download aria-hidden="true" />
        {t('pack.linkLabel')}
      </a>
    );
  }

  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <Download aria-hidden="true" />}
      {building ? t('pack.building') : t('pack.idleLabel')}
    </Button>
  );
}
