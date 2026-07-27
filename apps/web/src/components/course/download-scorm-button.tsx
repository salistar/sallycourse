'use client';

import { GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';
import { usePollForArtifact } from './use-poll-for-artifact';

/**
 * « Exporter en SCORM » (Prompt 42) — enfile un job packaging mode 'scorm'
 * (POST) puis sonde (GET) via {@link usePollForArtifact}. Cible /scorm-export :
 * paquet SCORM 1.2 importable dans un LMS tiers (Moodle, TalentLMS…).
 */
export interface DownloadScormButtonProps {
  courseId: string;
}

export function DownloadScormButton({ courseId }: DownloadScormButtonProps) {
  const t = useTranslations('course.download');
  const { phase, url, building, build } = usePollForArtifact({ courseId, path: 'scorm-export', sub: 'scorm' });

  if (phase === 'ready' && url) {
    return (
      <a href={url} download className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
        <GraduationCap aria-hidden="true" />
        {t('scorm.linkLabel')}
      </a>
    );
  }

  return (
    <Button variant="secondary" size="sm" loading={building} onClick={build}>
      {!building && <GraduationCap aria-hidden="true" />}
      {building ? t('scorm.building') : t('scorm.idleLabel')}
    </Button>
  );
}
