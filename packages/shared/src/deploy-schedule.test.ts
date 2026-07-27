// Tests de la logique PURE du planificateur drip (P181) : interprétation des
// cadences, dueness, clôture, calcul d'échéance, décision de passage et
// validation zod du plan. Aucune I/O — tout déterministe.
import { describe, expect, it } from 'vitest';
import {
  dripPlanInputSchema,
  dripCadenceSchema,
  parseCadence,
  isCompleted,
  isEntryComplete,
  itemsDue,
  computeNextRunAt,
  planEntryRun,
  buildScheduleEntries,
  cadenceLabel,
  type DripEntryState,
} from './deploy-schedule';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const NOW = new Date('2026-07-15T00:00:00Z');

function entry(overrides: Partial<DripEntryState> = {}): DripEntryState {
  return {
    platform: 'tiktok',
    cadence: { kind: 'per-day', count: 1, days: 30 },
    cursor: 0,
    nextRunAt: NOW,
    ...overrides,
  };
}

describe('parseCadence', () => {
  it('immediate : tout en un passage, sans intervalle', () => {
    expect(parseCadence({ kind: 'immediate' })).toEqual({
      perRun: Number.POSITIVE_INFINITY,
      intervalMs: 0,
      maxRuns: 1,
    });
  });

  it('per-week : count par semaine, non borné', () => {
    expect(parseCadence({ kind: 'per-week', count: 3 })).toEqual({
      perRun: 3,
      intervalMs: WEEK,
      maxRuns: null,
    });
  });

  it('per-day : count par jour, borné à M passages', () => {
    expect(parseCadence({ kind: 'per-day', count: 2, days: 10 })).toEqual({
      perRun: 2,
      intervalMs: DAY,
      maxRuns: 10,
    });
  });
});

describe('isCompleted', () => {
  it('immediate close après le premier passage (cursor > 0)', () => {
    expect(isCompleted(entry({ cadence: { kind: 'immediate' }, cursor: 0 }))).toBe(false);
    expect(isCompleted(entry({ cadence: { kind: 'immediate' }, cursor: 1 }))).toBe(true);
  });

  it('per-day close après M passages', () => {
    const cadence = { kind: 'per-day', count: 3, days: 4 } as const;
    // 4 passages × 3 = 12 éléments → close ; 11 (< 12 mais ceil(11/3)=4) → close aussi.
    expect(isCompleted(entry({ cadence, cursor: 9 }))).toBe(false); // 3 passages
    expect(isCompleted(entry({ cadence, cursor: 12 }))).toBe(true); // 4 passages
  });

  it('per-week n’est jamais close par nombre de passages', () => {
    expect(isCompleted(entry({ cadence: { kind: 'per-week', count: 5 }, cursor: 1000 }))).toBe(false);
  });
});

describe('isEntryComplete (finding 6 — 0 élément ≠ tout publié)', () => {
  it('NON terminée si aucun élément n’a jamais existé (cursor 0, remaining 0)', () => {
    // Cas central : entrée clip (tiktok) sans aucun ShortClip → reste active/idle.
    expect(isEntryComplete(entry({ cadence: { kind: 'per-week', count: 1 }, cursor: 0 }), 0)).toBe(false);
    expect(isEntryComplete(entry({ cadence: { kind: 'per-day', count: 1, days: 30 }, cursor: 0 }), 0)).toBe(false);
  });

  it('terminée par épuisement seulement si au moins un élément a été publié', () => {
    expect(isEntryComplete(entry({ cadence: { kind: 'per-week', count: 3 }, cursor: 6 }), 0)).toBe(true);
  });

  it('reste terminée par nombre de passages (immediate/per-day) indépendamment de remaining', () => {
    expect(isEntryComplete(entry({ cadence: { kind: 'immediate' }, cursor: 1 }), 5)).toBe(true);
  });
});

describe('itemsDue', () => {
  it('0 avant l’échéance', () => {
    const future = new Date(NOW.getTime() + DAY);
    expect(itemsDue(entry({ nextRunAt: future }), NOW)).toBe(0);
  });

  it('perRun à l’échéance', () => {
    expect(itemsDue(entry({ cadence: { kind: 'per-week', count: 3 }, nextRunAt: NOW }), NOW)).toBe(3);
  });

  it('Infinity pour immediate dû', () => {
    expect(itemsDue(entry({ cadence: { kind: 'immediate' }, nextRunAt: NOW }), NOW)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('dû immédiatement si nextRunAt null', () => {
    expect(itemsDue(entry({ cadence: { kind: 'per-day', count: 2, days: 5 }, nextRunAt: null }), NOW)).toBe(2);
  });

  it('0 si déjà close', () => {
    expect(itemsDue(entry({ cadence: { kind: 'immediate' }, cursor: 1 }), NOW)).toBe(0);
  });
});

describe('computeNextRunAt', () => {
  it('ajoute un intervalle à l’échéance courante (pas de dérive)', () => {
    const next = computeNextRunAt(entry({ cadence: { kind: 'per-day', count: 1, days: 30 }, nextRunAt: NOW }), NOW);
    expect(next.getTime()).toBe(NOW.getTime() + DAY);
  });

  it('per-week ajoute une semaine', () => {
    const next = computeNextRunAt(entry({ cadence: { kind: 'per-week', count: 3 }, nextRunAt: NOW }), NOW);
    expect(next.getTime()).toBe(NOW.getTime() + WEEK);
  });

  it('base sur now si nextRunAt null', () => {
    const next = computeNextRunAt(entry({ cadence: { kind: 'per-day', count: 1, days: 3 }, nextRunAt: null }), NOW);
    expect(next.getTime()).toBe(NOW.getTime() + DAY);
  });
});

describe('planEntryRun', () => {
  it('immediate publie tout ce qui reste et clôt', () => {
    const plan = planEntryRun(entry({ cadence: { kind: 'immediate' }, cursor: 0 }), 12, NOW);
    expect(plan.publishCount).toBe(12);
    expect(plan.nextCursor).toBe(12);
    expect(plan.done).toBe(true);
  });

  it('per-day publie le lot et re-planifie au lendemain', () => {
    const e = entry({ cadence: { kind: 'per-day', count: 3, days: 10 }, cursor: 0, nextRunAt: NOW });
    const plan = planEntryRun(e, 30, NOW);
    expect(plan.publishCount).toBe(3);
    expect(plan.nextCursor).toBe(3);
    expect(plan.done).toBe(false);
    expect(plan.nextRunAt.getTime()).toBe(NOW.getTime() + DAY);
  });

  it('borne la publication au nombre d’éléments restants', () => {
    const e = entry({ cadence: { kind: 'per-week', count: 5 }, cursor: 0, nextRunAt: NOW });
    const plan = planEntryRun(e, 2, NOW);
    expect(plan.publishCount).toBe(2);
    expect(plan.done).toBe(true); // plus rien à publier
  });

  it('ne publie rien avant l’échéance et ne re-planifie pas', () => {
    const future = new Date(NOW.getTime() + DAY);
    const e = entry({ cadence: { kind: 'per-day', count: 1, days: 5 }, cursor: 0, nextRunAt: future });
    const plan = planEntryRun(e, 5, NOW);
    expect(plan.publishCount).toBe(0);
    expect(plan.nextRunAt.getTime()).toBe(future.getTime());
    expect(plan.done).toBe(false);
  });

  it('clôt une cadence par jour à son dernier passage', () => {
    const cadence = { kind: 'per-day', count: 2, days: 3 } as const;
    // Déjà 2 passages (cursor=4) → ce 3e passage atteint maxRuns.
    const e = entry({ cadence, cursor: 4, nextRunAt: NOW });
    const plan = planEntryRun(e, 100, NOW);
    expect(plan.publishCount).toBe(2);
    expect(plan.nextCursor).toBe(6);
    expect(plan.done).toBe(true);
  });

  it('clôt sans publier si plus aucun élément disponible', () => {
    const e = entry({ cadence: { kind: 'per-week', count: 3 }, cursor: 6, nextRunAt: NOW });
    const plan = planEntryRun(e, 0, NOW);
    expect(plan.publishCount).toBe(0);
    expect(plan.done).toBe(true);
  });

  it('NE clôt PAS une entrée clip sans aucun élément (0 item, cursor 0) — finding 6', () => {
    // Aucun ShortClip encore produit : l'entrée reste active/idle, jamais « tout publié ».
    const e = entry({ cadence: { kind: 'per-week', count: 1 }, cursor: 0, nextRunAt: NOW });
    const plan = planEntryRun(e, 0, NOW);
    expect(plan.publishCount).toBe(0);
    expect(plan.done).toBe(false);
  });
});

describe('buildScheduleEntries', () => {
  it('crée des entrées cursor=0 à l’échéance startAt', () => {
    const start = '2026-08-01T09:00:00.000Z';
    const entries = buildScheduleEntries(
      {
        startAt: start,
        entries: [
          { platform: 'udemy', cadence: { kind: 'immediate' } },
          { platform: 'youtube', cadence: { kind: 'per-week', count: 3 } },
        ],
      },
      NOW,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ platform: 'udemy', cursor: 0 });
    expect(entries[0]!.nextRunAt!.toISOString()).toBe(start);
    expect(entries[1]!.nextRunAt!.toISOString()).toBe(start);
  });

  it('utilise now si startAt absent', () => {
    const entries = buildScheduleEntries({ entries: [{ platform: 'tiktok', cadence: { kind: 'immediate' } }] }, NOW);
    expect(entries[0]!.nextRunAt!.getTime()).toBe(NOW.getTime());
  });
});

describe('cadenceLabel', () => {
  it('rend un libellé lisible par nature', () => {
    expect(cadenceLabel({ kind: 'immediate' })).toBe('Immédiat');
    expect(cadenceLabel({ kind: 'per-week', count: 3 })).toBe('3 / semaine');
    expect(cadenceLabel({ kind: 'per-day', count: 1, days: 30 })).toBe('1 / jour pendant 30 j');
  });
});

describe('dripCadenceSchema', () => {
  it('accepte les trois variantes valides', () => {
    expect(dripCadenceSchema.safeParse({ kind: 'immediate' }).success).toBe(true);
    expect(dripCadenceSchema.safeParse({ kind: 'per-week', count: 3 }).success).toBe(true);
    expect(dripCadenceSchema.safeParse({ kind: 'per-day', count: 1, days: 30 }).success).toBe(true);
  });

  it('rejette per-day sans days et count invalide', () => {
    expect(dripCadenceSchema.safeParse({ kind: 'per-day', count: 1 }).success).toBe(false);
    expect(dripCadenceSchema.safeParse({ kind: 'per-week', count: 0 }).success).toBe(false);
  });
});

describe('dripPlanInputSchema', () => {
  it('valide un plan complet', () => {
    const parsed = dripPlanInputSchema.safeParse({
      entries: [
        { platform: 'udemy', cadence: { kind: 'immediate' } },
        { platform: 'youtube', cadence: { kind: 'per-week', count: 3 } },
        { platform: 'tiktok', cadence: { kind: 'per-day', count: 1, days: 30 } },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejette un plan sans entrée', () => {
    expect(dripPlanInputSchema.safeParse({ entries: [] }).success).toBe(false);
  });

  it('rejette les plateformes dupliquées', () => {
    const parsed = dripPlanInputSchema.safeParse({
      entries: [
        { platform: 'udemy', cadence: { kind: 'immediate' } },
        { platform: 'udemy', cadence: { kind: 'per-week', count: 2 } },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
