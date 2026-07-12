// Tests purs (P149) : recordAudit (best-effort, ne jette jamais) et la purge
// par rétention (calcul de dates, aucune I/O).
import { describe, expect, it, vi } from 'vitest';
import {
  AUDIT_RETENTION_DAYS,
  computeAuditRetentionCutoff,
  recordAudit,
  selectAuditLogsToPurge,
  type AuditWriter,
} from './audit';

describe('recordAudit', () => {
  it('appelle le writer avec l’entrée + un createdAt ajouté', async () => {
    const writer = vi.fn().mockResolvedValue(undefined);
    await recordAudit({ action: 'login', userId: 'u1' }, writer);

    expect(writer).toHaveBeenCalledTimes(1);
    const arg = writer.mock.calls[0]?.[0];
    expect(arg?.action).toBe('login');
    expect(arg?.userId).toBe('u1');
    expect(arg?.createdAt).toBeInstanceOf(Date);
  });

  it('ne jette jamais même si le writer échoue (Mongo indisponible)', async () => {
    const writer: AuditWriter = vi.fn().mockRejectedValue(new Error('Mongo down'));
    await expect(recordAudit({ action: 'course.deleted' }, writer)).resolves.toBeUndefined();
  });

  it('ne jette jamais même si le writer jette de façon synchrone', async () => {
    const writer: AuditWriter = vi.fn().mockImplementation(() => {
      throw new Error('boom synchrone');
    });
    await expect(recordAudit({ action: 'admin.access' }, writer)).resolves.toBeUndefined();
  });
});

describe('computeAuditRetentionCutoff', () => {
  it('recule de 365 jours par défaut', () => {
    const now = new Date(2026, 6, 12);
    const cutoff = computeAuditRetentionCutoff(now);
    const expected = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(cutoff.getTime()).toBe(expected.getTime());
  });

  it('accepte une fenêtre de rétention personnalisée', () => {
    const now = new Date(2026, 6, 12);
    const cutoff = computeAuditRetentionCutoff(now, 30);
    expect(cutoff.getTime()).toBe(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  });
});

describe('selectAuditLogsToPurge', () => {
  it('sélectionne uniquement les entrées plus anciennes que la fenêtre de rétention', () => {
    const now = new Date(2026, 6, 12);
    const entries = [
      { id: 'old', createdAt: new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000) }, // > 365j
      { id: 'recent', createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) }, // < 365j
      { id: 'boundary', createdAt: computeAuditRetentionCutoff(now) }, // pile au seuil : gardé (< strict)
    ];
    const toPurge = selectAuditLogsToPurge(entries, now);
    expect(toPurge).toEqual(['old']);
  });

  it('ne sélectionne rien si tout est récent', () => {
    const now = new Date(2026, 6, 12);
    const entries = [{ id: 'a', createdAt: new Date(now.getTime() - 1000) }];
    expect(selectAuditLogsToPurge(entries, now)).toEqual([]);
  });

  it('retourne un tableau vide sur une liste vide', () => {
    expect(selectAuditLogsToPurge([], new Date())).toEqual([]);
  });
});
