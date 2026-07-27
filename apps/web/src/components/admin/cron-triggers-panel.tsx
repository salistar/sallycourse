'use client';

import * as React from 'react';
import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
// Sous-module direct (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle CLIENT —
// constaté en réel le 2026-07-26 (UnhandledSchemeError au premier compile de
// /admin/jobs, qui cassait ensuite TOUTES les pages du dev server).
import { ADMIN_CRON_TRIGGERS } from '@sallycourse/shared/admin-crons';
import { Button, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/error-message';

/**
 * Panneau admin « Déclencher un cron » (P57) : un bouton par cron worker
 * (rétention, analytics, séquences e-mail, …). Un clic enfile un job `:manual`
 * sur la queue correspondante via POST /api/admin/cron. Utile pour rejouer un
 * batch sans attendre le scheduler (debug, incident, démo).
 */
export function CronTriggersPanel() {
  const t = useTranslations('admin.crons');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);

  const trigger = React.useCallback(
    async (key: string) => {
      setPending(key);
      try {
        const res = await fetch('/api/admin/cron', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
          toast({ title: t('errorTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
          return;
        }
        toast({ title: t('successTitle'), description: t('successDesc', { cron: t(`labels.${key}`) }), variant: 'success' });
      } catch {
        toast({ title: t('errorTitle'), description: t('networkError'), variant: 'danger' });
      } finally {
        setPending(null);
      }
    },
    [t, tApiError, toast],
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface/60 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_CRON_TRIGGERS.map((c) => (
          <div
            key={c.key}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-surface-subtle/40 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{t(`labels.${c.key}`)}</p>
              <p className="truncate text-2xs text-muted">{t(`descriptions.${c.key}`)}</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={pending === c.key}
              disabled={pending !== null}
              onClick={() => void trigger(c.key)}
            >
              {pending !== c.key && <Play aria-hidden="true" />}
              {t('runButton')}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
