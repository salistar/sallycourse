import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests des quotas & plans (P53). La logique PURE (getQuotaState, gates de
// déploiement) est testée directement ; la réservation atomique est testée en
// mockant @sallycourse/db (aucune connexion Mongo réelle).

// ── Mock de la couche DB ─────────────────────────────────────────
// findById().select().lean() et updateOne() sont contrôlés par test.
const findByIdMock = vi.fn();
const updateOneMock = vi.fn();

vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  User: {
    findById: (...args: unknown[]) => findByIdMock(...args),
    updateOne: (...args: unknown[]) => updateOneMock(...args),
  },
}));

// Import APRÈS le mock (hoisting vi.mock garanti par vitest).
import {
  checkAndReserveCourseQuota,
  checkDeployPlatformLimit,
  getQuotaState,
  maxDeployPlatformsForPlan,
  releaseQuota,
} from './quota';

/** Fabrique un chaînage findById().select().lean() résolvant `doc`. */
function mockUser(doc: unknown) {
  findByIdMock.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(doc) }),
  });
}

afterEach(() => {
  findByIdMock.mockReset();
  updateOneMock.mockReset();
});

describe('getQuotaState', () => {
  const now = new Date(Date.UTC(2026, 6, 15)); // 15 juillet 2026 UTC

  it('compte l’usage du mois courant et calcule le reset au mois suivant', () => {
    const state = getQuotaState(
      { plan: 'pro', quotaUsed: { coursesThisMonth: 3, periodStart: new Date(Date.UTC(2026, 6, 2)) } },
      now,
    );
    expect(state.used).toBe(3);
    expect(state.limit).toBe(10);
    expect(state.remaining).toBe(7);
    expect(state.resetsAt).toEqual(new Date(Date.UTC(2026, 7, 1)));
  });

  it('remet l’usage à zéro (virtuellement) quand le compteur date d’un autre mois', () => {
    const state = getQuotaState(
      { plan: 'free', quotaUsed: { coursesThisMonth: 1, periodStart: new Date(Date.UTC(2026, 5, 20)) } },
      now,
    );
    expect(state.used).toBe(0);
    expect(state.remaining).toBe(1);
  });

  it('business = illimité : Infinity partout et pas de date de reset', () => {
    const state = getQuotaState({ plan: 'business', quotaUsed: null }, now);
    expect(state.limit).toBe(Infinity);
    expect(state.remaining).toBe(Infinity);
    expect(state.resetsAt).toBeNull();
  });

  it('sans quotaUsed : usage 0 pour un plan payant fini', () => {
    const state = getQuotaState({ plan: 'pro' }, now);
    expect(state.used).toBe(0);
    expect(state.remaining).toBe(10);
  });

  it('tue le mutant even/même-mois : 31 décembre puis 1er janvier ne sont PAS le même mois', () => {
    // isSameUtcMonth compare année ET mois : ce cas tue une mutation qui
    // ignorerait l'année (ex. comparer seulement getUTCMonth()).
    const state = getQuotaState(
      {
        plan: 'free',
        quotaUsed: { coursesThisMonth: 1, periodStart: new Date(Date.UTC(2025, 11, 31)) },
      },
      new Date(Date.UTC(2026, 0, 1)),
    );
    expect(state.used).toBe(0);
    expect(state.remaining).toBe(1);
  });

  it('même mois, dernier jour à dernier jour : usage non remis à zéro', () => {
    const state = getQuotaState(
      { plan: 'pro', quotaUsed: { coursesThisMonth: 9, periodStart: new Date(Date.UTC(2026, 6, 1)) } },
      new Date(Date.UTC(2026, 6, 31, 23, 59, 59)),
    );
    expect(state.used).toBe(9);
    expect(state.remaining).toBe(1);
  });

  it('exactement à la limite (used === limit) : remaining tombe à 0, jamais négatif', () => {
    // Tue un mutant Math.max(0, limit-used) → (limit-used) qui laisserait
    // passer une valeur négative si used dépassait limit.
    const state = getQuotaState(
      { plan: 'free', quotaUsed: { coursesThisMonth: 1, periodStart: now } },
      now,
    );
    expect(state.remaining).toBe(0);
  });

  it('usage au-delà de la limite (incohérence de données) : remaining reste borné à 0', () => {
    const state = getQuotaState(
      { plan: 'free', quotaUsed: { coursesThisMonth: 5, periodStart: now } },
      now,
    );
    expect(state.remaining).toBe(0);
  });
});

describe('checkAndReserveCourseQuota', () => {
  it('utilisateur introuvable → user_not_found', async () => {
    mockUser(null);
    const res = await checkAndReserveCourseQuota('u1');
    expect(res).toEqual({ ok: false, reason: 'user_not_found' });
  });

  it('business (Infinity) → succès sans aucune écriture de compteur', async () => {
    mockUser({ plan: 'business', quotaUsed: { coursesThisMonth: 999, periodStart: new Date() } });
    const res = await checkAndReserveCourseQuota('u1');
    expect(res).toEqual({ ok: true });
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('même mois sous la limite → réservation atomique ($inc)', async () => {
    mockUser({ plan: 'pro', quotaUsed: { coursesThisMonth: 2, periodStart: new Date() } });
    updateOneMock.mockResolvedValue({ modifiedCount: 1 });
    const res = await checkAndReserveCourseQuota('u1');
    expect(res).toEqual({ ok: true });
    // Filtre borné par la limite → jamais de dépassement concurrent.
    const [filter, update] = updateOneMock.mock.calls[0]!;
    expect(filter['quotaUsed.coursesThisMonth']).toEqual({ $lt: 10 });
    expect(update).toEqual({ $inc: { 'quotaUsed.coursesThisMonth': 1 } });
  });

  it('même mois à la limite → quota_exceeded, sans écriture', async () => {
    mockUser({ plan: 'free', quotaUsed: { coursesThisMonth: 1, periodStart: new Date() } });
    const res = await checkAndReserveCourseQuota('u1');
    expect(res).toEqual({ ok: false, reason: 'quota_exceeded', plan: 'free', limit: 1 });
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('tue le mutant >= → > : dernier crédit dispo (used = limit-1) est réservable', async () => {
    // Plan pro (limit=10) avec 9 déjà utilisés : le 10e cours doit encore passer.
    mockUser({ plan: 'pro', quotaUsed: { coursesThisMonth: 9, periodStart: new Date() } });
    updateOneMock.mockResolvedValue({ modifiedCount: 1 });
    const res = await checkAndReserveCourseQuota('u1');
    expect(res).toEqual({ ok: true });
    const [filter] = updateOneMock.mock.calls[0]!;
    expect(filter['quotaUsed.coursesThisMonth']).toEqual({ $lt: 10 });
  });

  it('mois différent → reset du compteur à 1 avec periodStart courant', async () => {
    const lastMonth = new Date(Date.UTC(2026, 5, 1));
    mockUser({ plan: 'free', quotaUsed: { coursesThisMonth: 1, periodStart: lastMonth } });
    updateOneMock.mockResolvedValue({ modifiedCount: 1 });
    const res = await checkAndReserveCourseQuota('u1');
    expect(res).toEqual({ ok: true });
    const [, update] = updateOneMock.mock.calls[0]!;
    expect(update.$set.quotaUsed.coursesThisMonth).toBe(1);
  });

  it('course concurrente : modifiedCount 0 → quota_exceeded', async () => {
    mockUser({ plan: 'pro', quotaUsed: { coursesThisMonth: 9, periodStart: new Date() } });
    updateOneMock.mockResolvedValue({ modifiedCount: 0 });
    const res = await checkAndReserveCourseQuota('u1');
    expect(res).toEqual({ ok: false, reason: 'quota_exceeded', plan: 'pro', limit: 10 });
  });
});

describe('releaseQuota', () => {
  it('décrémente le compteur (borné à > 0)', async () => {
    updateOneMock.mockResolvedValue({ modifiedCount: 1 });
    await releaseQuota('u1');
    const [filter, update] = updateOneMock.mock.calls[0]!;
    expect(filter['quotaUsed.coursesThisMonth']).toEqual({ $gt: 0 });
    expect(update).toEqual({ $inc: { 'quotaUsed.coursesThisMonth': -1 } });
  });
});

describe('quota de déploiement', () => {
  it('free bridé à 1 plateforme par lot', () => {
    expect(maxDeployPlatformsForPlan('free')).toBe(1);
    expect(checkDeployPlatformLimit('free', 1).ok).toBe(true);
    const denied = checkDeployPlatformLimit('free', 3);
    expect(denied).toEqual({ ok: false, plan: 'free', limit: 1, requested: 3 });
  });

  it('pro et business déploient partout (Infinity)', () => {
    expect(maxDeployPlatformsForPlan('pro')).toBe(Infinity);
    expect(maxDeployPlatformsForPlan('business')).toBe(Infinity);
    expect(checkDeployPlatformLimit('pro', 9).ok).toBe(true);
    expect(checkDeployPlatformLimit('business', 50).ok).toBe(true);
  });
});
