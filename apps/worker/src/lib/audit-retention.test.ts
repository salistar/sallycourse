// Tests de la purge par rétention du journal d'audit (Prompt 149) : Mongo
// mocké (AuditLog.find/deleteMany), la décision de rétention elle-même est
// déjà couverte (pure) par packages/shared/src/audit.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFind = vi.hoisted(() => vi.fn());
const mockDeleteMany = vi.hoisted(() => vi.fn(async () => ({ deletedCount: 0 })));

vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return {
    ...actual,
    AuditLog: { find: mockFind, deleteMany: mockDeleteMany },
  };
});

import { purgeExpiredAuditLogs } from './audit-retention.js';

/** Construit un objet { select, lean } chaînable renvoyant `data`. */
function selectLean<T>(data: T) {
  return { select: () => ({ lean: async () => data }) };
}

beforeEach(() => {
  mockFind.mockReset();
  mockDeleteMany.mockReset();
  mockDeleteMany.mockResolvedValue({ deletedCount: 0 });
});

describe('purgeExpiredAuditLogs', () => {
  it('supprime uniquement les entrées plus anciennes que 12 mois', async () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    mockFind.mockReturnValue(
      selectLean([
        { _id: 'old', createdAt: new Date('2024-01-01T00:00:00.000Z') },
        { _id: 'recent', createdAt: new Date('2026-07-01T00:00:00.000Z') },
      ]),
    );
    mockDeleteMany.mockResolvedValue({ deletedCount: 1 });

    const count = await purgeExpiredAuditLogs(now);

    expect(mockDeleteMany).toHaveBeenCalledWith({ _id: { $in: ['old'] } });
    expect(count).toBe(1);
  });

  it("n'appelle pas deleteMany si aucune entrée n'est expirée", async () => {
    const now = new Date('2026-07-11T00:00:00.000Z');
    mockFind.mockReturnValue(selectLean([{ _id: 'recent', createdAt: new Date('2026-07-01T00:00:00.000Z') }]));

    const count = await purgeExpiredAuditLogs(now);

    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('retourne 0 sur une collection vide', async () => {
    mockFind.mockReturnValue(selectLean([]));
    const count = await purgeExpiredAuditLogs(new Date());
    expect(count).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});
