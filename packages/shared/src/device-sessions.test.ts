// Tests purs (P206) : évaluation des appareils simultanés (fenêtre glissante,
// déduplication) et politique d'alerte anti-partage. Aucune I/O.
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WINDOW_MS,
  ALERT_COOLDOWN_MS,
  MAX_CONCURRENT_DEVICES,
  evaluateConcurrentSessions,
  shouldAlertAccountSharing,
  type ViewingSessionLike,
} from './device-sessions';

const NOW = 1_000_000_000;

const s = (deviceId: string, agoMs: number): ViewingSessionLike => ({
  deviceId,
  lastSeenAt: NOW - agoMs,
});

describe('evaluateConcurrentSessions', () => {
  it('compte les appareils distincts actifs dans la fenêtre', () => {
    const res = evaluateConcurrentSessions([s('a', 0), s('b', 1000)], { now: NOW });
    expect(res.activeCount).toBe(2);
    expect(res.overLimit).toBe(false);
    expect(res.activeDeviceIds.sort()).toEqual(['a', 'b']);
  });

  it('dédoublonne un même appareil vu plusieurs fois', () => {
    const res = evaluateConcurrentSessions([s('a', 0), s('a', 500), s('a', 900)], { now: NOW });
    expect(res.activeCount).toBe(1);
    expect(res.overLimit).toBe(false);
  });

  it('ignore les appareils hors fenêtre', () => {
    const res = evaluateConcurrentSessions(
      [s('a', 0), s('b', ACTIVE_WINDOW_MS + 1)],
      { now: NOW },
    );
    expect(res.activeCount).toBe(1);
    expect(res.activeDeviceIds).toEqual(['a']);
  });

  it('signale le dépassement au-delà du maximum (défaut 2)', () => {
    const res = evaluateConcurrentSessions([s('a', 0), s('b', 0), s('c', 0)], { now: NOW });
    expect(res.activeCount).toBe(3);
    expect(res.overLimit).toBe(true);
    expect(MAX_CONCURRENT_DEVICES).toBe(2);
  });

  it('respecte un maxDevices personnalisé', () => {
    const res = evaluateConcurrentSessions([s('a', 0), s('b', 0)], { now: NOW, maxDevices: 1 });
    expect(res.overLimit).toBe(true);
  });

  it('ignore une entrée sans deviceId', () => {
    const res = evaluateConcurrentSessions([{ deviceId: '', lastSeenAt: NOW }], { now: NOW });
    expect(res.activeCount).toBe(0);
  });
});

describe('shouldAlertAccountSharing', () => {
  it("n'alerte jamais sans dépassement", () => {
    expect(shouldAlertAccountSharing(false, null, { now: NOW })).toBe(false);
  });

  it('alerte au premier dépassement (aucune alerte antérieure)', () => {
    expect(shouldAlertAccountSharing(true, null, { now: NOW })).toBe(true);
    expect(shouldAlertAccountSharing(true, undefined, { now: NOW })).toBe(true);
  });

  it('respecte le cooldown entre deux alertes', () => {
    expect(shouldAlertAccountSharing(true, NOW - 1000, { now: NOW })).toBe(false);
    expect(shouldAlertAccountSharing(true, NOW - ALERT_COOLDOWN_MS, { now: NOW })).toBe(true);
  });
});
