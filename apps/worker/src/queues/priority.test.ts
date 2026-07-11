// Tests purs de priorityForPlan (P73) — aucun I/O.
import { describe, expect, it } from 'vitest';
import { priorityForPlan } from './priority.js';

describe('priorityForPlan', () => {
  it('business est le plus prioritaire (plus petit nombre)', () => {
    expect(priorityForPlan('business')).toBe(1);
  });

  it('pro est prioritaire mais après business', () => {
    expect(priorityForPlan('pro')).toBe(5);
  });

  it('free est traité en dernier', () => {
    expect(priorityForPlan('free')).toBe(10);
  });

  it('ordre respecté : business < pro < free', () => {
    expect(priorityForPlan('business')).toBeLessThan(priorityForPlan('pro'));
    expect(priorityForPlan('pro')).toBeLessThan(priorityForPlan('free'));
  });

  it('plan inconnu retombe sur la priorité free (pas de passe-droit)', () => {
    expect(priorityForPlan('inexistant')).toBe(priorityForPlan('free'));
  });

  it('plan absent (undefined/null) retombe sur free', () => {
    expect(priorityForPlan(undefined)).toBe(priorityForPlan('free'));
    expect(priorityForPlan(null)).toBe(priorityForPlan('free'));
  });
});
