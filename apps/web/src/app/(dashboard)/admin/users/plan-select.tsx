'use client';

import * as React from 'react';
import { useFormStatus } from 'react-dom';
import { Select } from '@/components/ui';
import type { PlanId } from '@sallycourse/shared';
import { setPlanAction } from './actions';

/**
 * Sélecteur de plan par utilisateur (P57) : soumet l'action serveur au
 * changement (pas de bouton). Désactivé pendant la soumission.
 */

const PLAN_OPTIONS: PlanId[] = ['free', 'pro', 'business'];

function PlanSelectInner({ current }: { current: PlanId }) {
  const { pending } = useFormStatus();
  return (
    <Select
      name="plan"
      defaultValue={current}
      disabled={pending}
      aria-label="Changer le plan"
      className="h-9 w-32 text-sm"
      onChange={(e) => {
        // Soumet le formulaire parent au changement de valeur.
        if (e.currentTarget.value !== current) e.currentTarget.form?.requestSubmit();
      }}
    >
      {PLAN_OPTIONS.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </Select>
  );
}

export function PlanSelect({ userId, current }: { userId: string; current: PlanId }) {
  return (
    <form action={setPlanAction}>
      <input type="hidden" name="userId" value={userId} />
      <PlanSelectInner current={current} />
    </form>
  );
}
