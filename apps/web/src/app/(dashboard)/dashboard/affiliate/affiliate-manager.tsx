'use client';

import * as React from 'react';
import { Copy, Gift, MousePointerClick, TrendingUp, Wallet } from 'lucide-react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Card, CardContent, CardHeader, CardTitle, Button, useToast } from '@/components/ui';
import type { AffiliateStats } from '@/lib/payments/affiliate-service';

/**
 * Client de la page Affiliation : lien copiable + cartes de statistiques.
 * Aucune donnée n'est refetchée côté client (page serveur revalidée à chaque
 * visite via `dynamic = 'force-dynamic'`) — assez pour un tableau de suivi.
 */

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted">{label}</p>
          <p className="truncate font-display text-xl font-semibold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export interface AffiliateManagerProps {
  shareUrl: string;
  stats: AffiliateStats;
}

export function AffiliateManager({ shareUrl, stats }: AffiliateManagerProps) {
  const { toast } = useToast();
  const t = useTranslations('affiliate');
  const format = useFormatter();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ variant: 'success', title: t('linkCopied') });
    } catch {
      toast({ variant: 'danger', title: t('copyFailed') });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gift className="size-5 text-accent" aria-hidden="true" />
            <CardTitle className="text-lg">{t('title')}</CardTitle>
          </div>
          <p className="text-sm text-muted">
            {t.rich('commissionNote', {
              rate: Math.round(stats.commissionRate * 100),
              badge: (chunks) => <Badge variant="published">{chunks}</Badge>,
            })}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 truncate rounded-sm bg-surface-subtle px-3 py-2 text-sm">{shareUrl}</code>
            <Button variant="secondary" size="sm" onClick={copyLink}>
              <Copy aria-hidden="true" /> {t('copyLink')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={MousePointerClick} label={t('clicks')} value={format.number(stats.clicks)} />
        <StatCard icon={TrendingUp} label={t('conversions')} value={format.number(stats.conversions)} />
        <StatCard
          icon={Wallet}
          label={t('pendingEarnings')}
          value={format.number(stats.pendingCommissionsUsd, { style: 'currency', currency: 'USD' })}
        />
      </div>

      {stats.paidCommissionsUsd > 0 && (
        <p className="text-sm text-muted">
          {t.rich('alreadyPaid', {
            amount: format.number(stats.paidCommissionsUsd, { style: 'currency', currency: 'USD' }),
            strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          })}
        </p>
      )}
    </div>
  );
}
