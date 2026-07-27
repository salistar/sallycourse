// Tests du scheduler drip (P181) en MOCK : aucune vraie DB / Redis. On mocke les
// modèles Mongoose (shared.js), la queue et le publieur de clips ; la logique de
// décision PURE (planEntryRun, isCompleted…) reste la vraie implémentation
// (importOriginal). On vérifie l'orchestration : publication des clips par lot,
// enfilage du déploiement de cours, avancée du cursor et clôture du plan.
import { describe, expect, it, vi, beforeEach } from 'vitest';

/* ── Mocks d'I/O ──────────────────────────────────────────────── */

const publishScheduledClip = vi.fn(async (clip: { status: string }) => {
  clip.status = 'published';
});
// finding 7 : le drip PROGRAMME les clips 'draft' (draft → scheduled) au lieu de
// les publier directement ; publishDueShortClips les publie ensuite.
const scheduleClipPublish = vi.fn(async (clips: { status: string }[]) => {
  for (const c of clips) c.status = 'scheduled';
});
vi.mock('../deploy/adapters/shorts-repurposing.js', () => ({ publishScheduledClip, scheduleClipPublish }));

const queueAdd = vi.fn().mockResolvedValue(undefined);
const queueRemove = vi.fn().mockResolvedValue(undefined);
vi.mock('../queues/index.js', () => ({
  createQueue: vi.fn(() => ({ add: queueAdd, remove: queueRemove })),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../queues/connection.js', () => ({ getRedisConnection: () => ({}) }));

/* ── Modèles Mongoose mockés (le reste de shared.js reste réel) ── */

const ShortClip = {
  countDocuments: vi.fn(),
  find: vi.fn(),
};
const Course = { findById: vi.fn() };
const PlatformCredential = { findOne: vi.fn() };
const Deployment = { findOneAndUpdate: vi.fn().mockResolvedValue({}) };

vi.mock('../shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared.js')>();
  return {
    ...actual,
    ShortClip,
    Course,
    PlatformCredential,
    Deployment,
    getConfig: () => ({ MOCK_PROVIDERS: true, CREDENTIALS_MASTER_KEY: 'k' }),
  };
});

// Import APRÈS les mocks (hoisting vi.mock garantit l'ordre).
const { processDeploySchedule, publishDueShortClips } = await import('./deploy-schedule.js');

const NOW = new Date('2026-07-15T12:00:00Z');
const PAST = new Date('2026-07-14T12:00:00Z');

interface FakeEntry {
  platform: string;
  cadence: unknown;
  cursor: number;
  nextRunAt?: Date;
}
function makeSchedule(entries: FakeEntry[]) {
  return {
    _id: 's1',
    courseId: 'c1',
    userId: 'u1',
    status: 'active' as string,
    entries,
    save: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Deployment.findOneAndUpdate.mockResolvedValue({});
});

describe('processDeploySchedule — plateforme de clips (tiktok)', () => {
  it('programme le lot suivant (scheduleClipPublish), avance le cursor et re-planifie', async () => {
    ShortClip.countDocuments.mockResolvedValue(10); // 10 clips restants
    const clips = [{ status: 'draft' }, { status: 'draft' }];
    ShortClip.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve(clips) }) });

    const schedule = makeSchedule([
      { platform: 'tiktok', cadence: { kind: 'per-day', count: 2, days: 5 }, cursor: 0, nextRunAt: PAST },
    ]);
    const outcome = await processDeploySchedule(schedule as never, NOW, true);

    // Le drip PROGRAMME les 2 clips 'draft' dus (scheduledAt=now), il ne publie pas lui-même.
    expect(scheduleClipPublish).toHaveBeenCalledTimes(1);
    expect(scheduleClipPublish).toHaveBeenCalledWith(clips, NOW, 0);
    expect(publishScheduledClip).not.toHaveBeenCalled();
    expect(outcome.published).toBe(2);
    expect(schedule.entries[0]!.cursor).toBe(2);
    expect(outcome.completed).toBe(false);
    // Échéance re-planifiée au lendemain.
    expect(schedule.entries[0]!.nextRunAt!.getTime()).toBe(PAST.getTime() + 24 * 3600 * 1000);
  });

  it('clôt le plan quand tous les clips ont été programmés', async () => {
    ShortClip.countDocuments.mockResolvedValue(1); // 1 seul clip restant
    ShortClip.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([{ status: 'draft' }]) }) });

    const schedule = makeSchedule([
      { platform: 'tiktok', cadence: { kind: 'per-day', count: 2, days: 5 }, cursor: 0, nextRunAt: PAST },
    ]);
    const outcome = await processDeploySchedule(schedule as never, NOW, true);

    expect(scheduleClipPublish).toHaveBeenCalledTimes(1);
    expect(outcome.published).toBe(1);
    expect(outcome.completed).toBe(true);
    expect(schedule.status).toBe('completed');
  });

  it('NE clôt PAS et ne programme rien si le cours n’a aucun ShortClip (finding 6/7)', async () => {
    ShortClip.countDocuments.mockResolvedValue(0); // aucun clip exploitable
    ShortClip.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([]) }) });

    const schedule = makeSchedule([
      { platform: 'tiktok', cadence: { kind: 'per-day', count: 1, days: 5 }, cursor: 0, nextRunAt: PAST },
    ]);
    const outcome = await processDeploySchedule(schedule as never, NOW, true);

    expect(scheduleClipPublish).not.toHaveBeenCalled();
    expect(outcome.published).toBe(0);
    expect(outcome.completed).toBe(false); // reste active/idle (pas « tout publié »)
    expect(schedule.status).toBe('active');
  });
});

describe('processDeploySchedule — plateforme de cours (udemy)', () => {
  it('enfile un déploiement complet et clôt (unité unique)', async () => {
    const schedule = makeSchedule([
      { platform: 'udemy', cadence: { kind: 'immediate' }, cursor: 0, nextRunAt: PAST },
    ]);
    const outcome = await processDeploySchedule(schedule as never, NOW, true);

    expect(Deployment.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0]![0]).toBe('deploy-course');
    expect(outcome.jobsEnqueued).toBe(1);
    expect(schedule.entries[0]!.cursor).toBe(1);
    expect(outcome.completed).toBe(true);
  });

  it('ne republie pas un cours déjà déployé (cursor >= 1)', async () => {
    const schedule = makeSchedule([
      { platform: 'udemy', cadence: { kind: 'immediate' }, cursor: 1, nextRunAt: PAST },
    ]);
    const outcome = await processDeploySchedule(schedule as never, NOW, true);

    expect(queueAdd).not.toHaveBeenCalled();
    expect(outcome.jobsEnqueued).toBe(0);
    expect(outcome.completed).toBe(true);
  });
});

describe('processDeploySchedule — entrée non due', () => {
  it('ne publie rien avant l’échéance et laisse le plan actif', async () => {
    ShortClip.countDocuments.mockResolvedValue(10);
    const future = new Date(NOW.getTime() + 24 * 3600 * 1000);
    const schedule = makeSchedule([
      { platform: 'tiktok', cadence: { kind: 'per-day', count: 1, days: 5 }, cursor: 0, nextRunAt: future },
    ]);
    const outcome = await processDeploySchedule(schedule as never, NOW, true);

    expect(scheduleClipPublish).not.toHaveBeenCalled();
    expect(publishScheduledClip).not.toHaveBeenCalled();
    expect(outcome.completed).toBe(false);
    expect(schedule.status).toBe('active');
    expect(schedule.entries[0]!.nextRunAt!.getTime()).toBe(future.getTime());
  });
});

describe('publishDueShortClips', () => {
  it('publie les ShortClip programmés dus (status scheduled)', async () => {
    const clips = [{ courseId: 'c1', platform: 'tiktok', status: 'scheduled', _id: 'k1' }];
    ShortClip.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve(clips) }) });
    Course.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ userId: 'u1' }) }) });

    const res = await publishDueShortClips(NOW);

    expect(publishScheduledClip).toHaveBeenCalledTimes(1);
    expect(res.published).toBe(1);
    expect(res.failed).toBe(0);
  });

  it('best-effort : un échec de clip n’interrompt pas les autres', async () => {
    const clips = [
      { courseId: 'c1', platform: 'tiktok', status: 'scheduled', _id: 'k1' },
      { courseId: 'c1', platform: 'tiktok', status: 'scheduled', _id: 'k2' },
    ];
    ShortClip.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve(clips) }) });
    Course.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ userId: 'u1' }) }) });
    publishScheduledClip.mockRejectedValueOnce(new Error('boom'));

    const res = await publishDueShortClips(NOW);

    expect(res.failed).toBe(1);
    expect(res.published).toBe(1);
  });
});
