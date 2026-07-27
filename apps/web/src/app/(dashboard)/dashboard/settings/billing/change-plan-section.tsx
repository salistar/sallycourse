'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Changer d'offre » (Réglages → Facturation) — les routes de checkout
 * existaient sans AUCUN bouton (audit connectivité 2026-07-17) : impossible de
 * passer Pro/Business depuis l'app. Flux : POST /api/payments/cmi/checkout
 * → formulaire signé CMI auto-soumis ; CMI non configuré (503, dev) → repli
 * explicite sur le paiement SIMULÉ (/api/payments/mock/activate) avec mention.
 */

const PLANS = [
  {
    id: 'pro',
    label: 'Pro',
    icon: Sparkles,
    perksKey: 'proPerks',
  },
  {
    id: 'business',
    label: 'Business',
    icon: Crown,
    perksKey: 'businessPerks',
  },
] as const;

/** Soumet le formulaire de paiement CMI signé (redirection pleine page). */
function submitCmiForm(action: string, fields: Record<string, string>): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** Prix formatés par plan (calculés côté serveur depuis PLAN_PRICING). */
export interface PlanPrices {
  pro: { mad: string; eur: string };
  business: { mad: string; eur: string };
}

export function ChangePlanSection({
  currentPlan,
  prices,
}: {
  currentPlan: string;
  prices: PlanPrices;
}) {
  const router = useRouter();
  const t = useTranslations('settings.changePlan');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  const upgrade = async (plan: 'pro' | 'business') => {
    setBusy(plan);
    try {
      const res = await fetch('/api/payments/cmi/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (res.ok) {
        const data = (await res.json()) as { action: string; fields: Record<string, string> };
        submitCmiForm(data.action, data.fields);
        return; // redirection CMI en cours
      }
      if (res.status === 503) {
        // CMI non configuré (dev) : paiement simulé, annoncé comme tel.
        if (!window.confirm(t('confirmMockPayment'))) {
          return;
        }
        const mock = await fetch('/api/payments/mock/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
        });
        const mockData = (await mock.json().catch(() => null)) as { error?: string } | null;
        if (!mock.ok) {
          toast({ variant: 'danger', title: t('activationFailed'), description: errorMessage(mockData, tApiError) });
          return;
        }
        toast({ variant: 'success', title: t('planActivatedSimulated', { plan }) });
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast({ variant: 'danger', title: t('paymentFailed'), description: errorMessage(data, tApiError) });
    } catch {
      toast({ variant: 'danger', title: t('networkError'), description: t('serverUnreachable') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('sectionLabel')}</p>
        <CardTitle className="mt-0.5 text-lg">{t('title')}</CardTitle>
        <p className="text-sm text-muted">
          {t('currentPlanLabel')} <Badge variant="ready">{currentPlan}</Badge>
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className="flex flex-1 flex-col gap-3 rounded-md border border-border bg-surface p-4"
          >
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <plan.icon className="size-4 text-accent" aria-hidden="true" />
              {plan.label}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-xl font-semibold text-foreground">
                {prices[plan.id].mad}
              </span>
              <span className="text-2xs text-muted">{t('perMonthApprox')} {prices[plan.id].eur}</span>
            </div>
            <p className="text-sm text-muted">{t(plan.perksKey)}</p>
            <Button
              variant={plan.id === 'business' ? 'gold' : 'secondary'}
              size="sm"
              disabled={currentPlan === plan.id}
              loading={busy === plan.id}
              onClick={() => void upgrade(plan.id)}
            >
              {currentPlan === plan.id ? t('currentPlanButton') : t('switchTo', { label: plan.label })}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
