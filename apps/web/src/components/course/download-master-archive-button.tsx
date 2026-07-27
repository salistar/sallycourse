'use client';

import { Archive } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePollForArtifact } from './use-poll-for-artifact';

/**
 * « Archive maître (ré-importable) » (Prompt 182) — enfile un job packaging
 * (POST) puis sonde (GET) jusqu'à disponibilité via {@link usePollForArtifact}.
 * Cible /master-archive : ZIP anti-lock-in contenant toutes les sources JSON
 * (course/sections/lessons AVEC script/quizzes) + tous les médias, documenté et
 * ré-importable via « Importer une archive ».
 */
export interface DownloadMasterArchiveButtonProps {
  courseId: string;
}

export function DownloadMasterArchiveButton({ courseId }: DownloadMasterArchiveButtonProps) {
  const t = useTranslations('course.download');
  const { phase, url, building, build } = usePollForArtifact({ courseId, path: 'master-archive', sub: 'master' });

  if (phase === 'ready' && url) {
    return (
      <a href={url} download className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
        <Archive aria-hidden="true" />
        {t('master.linkLabel')}
      </a>
    );
  }

  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <Archive aria-hidden="true" />}
      {building ? t('master.building') : t('master.idleLabel')}
    </Button>
  );
}
