'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Users } from 'lucide-react';
import { Badge, Button, useToast } from '@/components/ui';
import { useTranslations, useFormatter } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * Bandeau d'approbation d'équipe (Prompt 138) — affiché uniquement pour un
 * cours rattaché à un Workspace dont au moins un reviewer existe. Montre le
 * statut d'approbation courant et laisse un owner/reviewer approuver en un
 * clic (le déploiement reste bloqué côté API tant que non approuvé).
 */

export interface TeamApprovalBannerProps {
  courseId: string;
  role: 'owner' | 'editor' | 'reviewer';
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export function TeamApprovalBanner({ courseId, role, approvedBy, approvedAt }: TeamApprovalBannerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.teamApproval');
  const tApiError = useTranslations('apiErrors');
  const format = useFormatter();
  const [approving, setApproving] = React.useState(false);

  const canApprove = role === 'owner' || role === 'reviewer';
  const approved = Boolean(approvedBy);

  const approve = async () => {
    setApproving(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/approve-deploy`, { method: 'POST' });
      if (res.ok) {
        toast({
          title: t('toastApprovedTitle'),
          description: t('toastApprovedDesc'),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('toastErrorTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: t('toastNetworkTitle'),
        description: t('toastNetworkDesc'),
        variant: 'danger',
      });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <Users className="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('title')}</p>
          <p className="text-xs text-muted">
            {approved ? (
              t('approvedOn', {
                date: approvedAt
                  ? format.dateTime(new Date(approvedAt), { day: 'numeric', month: 'long', year: 'numeric' })
                  : '',
              })
            ) : (
              t('pendingHint')
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={approved ? 'ready' : 'draft'} hideDot={false}>
          {approved ? t('statusApproved') : t('statusPending')}
        </Badge>
        {!approved && canApprove && (
          <Button variant="secondary" size="sm" loading={approving} onClick={approve}>
            {!approving && <ShieldCheck aria-hidden="true" />}
            {t('approveButton')}
          </Button>
        )}
      </div>
    </div>
  );
}
