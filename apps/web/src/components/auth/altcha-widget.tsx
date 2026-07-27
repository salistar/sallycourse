'use client';

import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { solveAltchaChallenge, type AltchaSolvedPayload } from '@/lib/altcha-client';

interface AltchaWidgetProps {
  /** Reçoit la solution résolue (à joindre au payload du formulaire), ou null tant que non résolue/en échec. */
  onSolved: (solution: AltchaSolvedPayload | null) => void;
}

type AltchaState = 'loading' | 'solving' | 'solved' | 'error';

/**
 * Widget ALTCHA (P159) — récupère un challenge côté serveur (GET /api/altcha)
 * puis le résout en arrière-plan (preuve de travail, Web Crypto natif), sans
 * dépendance externe ni tracking tiers. Affiche un état visuel simple ;
 * l'appelant (formulaire) doit bloquer la soumission tant que `onSolved`
 * n'a pas reçu de solution non nulle.
 */
export function AltchaWidget({ onSolved }: AltchaWidgetProps) {
  const [state, setState] = React.useState<AltchaState>('loading');
  const t = useTranslations('auth.altcha');

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setState('loading');
      try {
        const response = await fetch('/api/altcha');
        if (!response.ok) throw new Error('challenge indisponible');
        const challenge = await response.json();
        if (cancelled) return;

        setState('solving');
        const solution = await solveAltchaChallenge(challenge);
        if (cancelled) return;

        if (solution.number < 0) {
          setState('error');
          onSolved(null);
          return;
        }
        setState('solved');
        onSolved(solution);
      } catch {
        if (!cancelled) {
          setState('error');
          onSolved(null);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted">
      <ShieldCheck
        aria-hidden="true"
        className={state === 'solved' ? 'text-success' : 'text-muted'}
      />
      {state === 'loading' && t('loading')}
      {state === 'solving' && t('solving')}
      {state === 'solved' && t('solved')}
      {state === 'error' && t('error')}
    </div>
  );
}
