import { describe, expect, it } from 'vitest';
import { auditLogsToCsv, buildAuditLogFilter } from './audit-log-query';

describe('buildAuditLogFilter', () => {
  it('ne filtre rien si aucun paramètre fourni', () => {
    expect(buildAuditLogFilter({})).toEqual({});
  });

  it('filtre par userId', () => {
    expect(buildAuditLogFilter({ userId: 'u1' })).toEqual({ userId: 'u1' });
  });

  it('ignore action="all" (pas de filtre)', () => {
    expect(buildAuditLogFilter({ action: 'all' })).toEqual({});
  });

  it('filtre par action précise', () => {
    expect(buildAuditLogFilter({ action: 'login' })).toEqual({ action: 'login' });
  });

  it('applique une borne de date basse (from)', () => {
    const result = buildAuditLogFilter({ from: '2026-01-01' });
    expect(result.createdAt).toBeDefined();
    expect((result.createdAt as { $gte: Date }).$gte.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('applique une borne de date haute (to) en fin de journée', () => {
    const result = buildAuditLogFilter({ to: '2026-01-31' });
    const to = (result.createdAt as { $lte: Date }).$lte;
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
  });

  it('combine userId + action + bornes de date', () => {
    const result = buildAuditLogFilter({ userId: 'u1', action: 'course.deleted', from: '2026-01-01', to: '2026-01-31' });
    expect(result.userId).toBe('u1');
    expect(result.action).toBe('course.deleted');
    expect(result.createdAt).toBeDefined();
  });

  it('ignore une date invalide sans jeter', () => {
    expect(() => buildAuditLogFilter({ from: 'pas-une-date' })).not.toThrow();
    const result = buildAuditLogFilter({ from: 'pas-une-date' });
    expect(result.createdAt).toBeUndefined();
  });
});

describe('auditLogsToCsv', () => {
  it('génère un en-tête et trie du plus récent au plus ancien', () => {
    const csv = auditLogsToCsv([
      { id: '1', action: 'login', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { id: '2', action: 'register', createdAt: new Date('2026-02-01T00:00:00.000Z') },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('date,utilisateur,action,cible_type,cible_id,ip,user_agent');
    // La plus récente (register, février) doit précéder la plus ancienne.
    expect(lines[1]).toContain('register');
    expect(lines[2]).toContain('login');
  });

  it('échappe les valeurs contenant des virgules', () => {
    const csv = auditLogsToCsv([
      {
        id: '1',
        action: 'login',
        userAgent: 'Mozilla, test',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    expect(csv).toContain('"Mozilla, test"');
  });

  it('retourne uniquement l’en-tête sur une liste vide', () => {
    expect(auditLogsToCsv([])).toBe('date,utilisateur,action,cible_type,cible_id,ip,user_agent');
  });
});
