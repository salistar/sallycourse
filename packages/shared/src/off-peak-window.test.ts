// Tests purs (P134) : calcul de la prochaine fenêtre creuse — aucune I/O,
// uniquement des dates fixées explicitement (déterministe, pas de fake timers requis).
import { describe, expect, it } from 'vitest';
import {
  OFF_PEAK_END_HOUR,
  OFF_PEAK_START_HOUR,
  computeNextOffPeakDelayMs,
  computeNextOffPeakStart,
} from './off-peak-window';

describe('computeNextOffPeakStart', () => {
  it('renvoie l’instant courant si déjà dans la fenêtre creuse', () => {
    const now = new Date(2026, 6, 12, 3, 30, 15);
    const next = computeNextOffPeakStart(now);
    expect(next.getTime()).toBe(now.getTime());
  });

  it('renvoie la borne de début si déjà dans la fenêtre (limite inférieure incluse)', () => {
    const now = new Date(2026, 6, 12, OFF_PEAK_START_HOUR, 0, 0);
    const next = computeNextOffPeakStart(now);
    expect(next.getTime()).toBe(now.getTime());
  });

  it('renvoie la fenêtre du jour même si avant (ex. 23h) : lendemain 2h', () => {
    const now = new Date(2026, 6, 12, 23, 0, 0);
    const next = computeNextOffPeakStart(now);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(6);
    expect(next.getDate()).toBe(13);
    expect(next.getHours()).toBe(OFF_PEAK_START_HOUR);
    expect(next.getMinutes()).toBe(0);
  });

  it('renvoie la fenêtre du jour même si avant le matin (ex. 8h) : demain 2h', () => {
    const now = new Date(2026, 6, 12, 8, 15, 0);
    const next = computeNextOffPeakStart(now);
    expect(next.getDate()).toBe(13);
    expect(next.getHours()).toBe(OFF_PEAK_START_HOUR);
  });

  it('renvoie la fenêtre du même jour si avant 2h du matin (ex. 0h30)', () => {
    const now = new Date(2026, 6, 12, 0, 30, 0);
    const next = computeNextOffPeakStart(now);
    expect(next.getDate()).toBe(12);
    expect(next.getHours()).toBe(OFF_PEAK_START_HOUR);
    expect(next.getMinutes()).toBe(0);
  });

  it('la fin de fenêtre (6h pile) n’est plus considérée creuse', () => {
    const now = new Date(2026, 6, 12, OFF_PEAK_END_HOUR, 0, 0);
    const next = computeNextOffPeakStart(now);
    // 6h n'est pas dans [2,6) → reporté au lendemain 2h.
    expect(next.getDate()).toBe(13);
    expect(next.getHours()).toBe(OFF_PEAK_START_HOUR);
  });
});

describe('computeNextOffPeakDelayMs', () => {
  it('retourne 0 si déjà dans la fenêtre creuse', () => {
    const now = new Date(2026, 6, 12, 4, 0, 0);
    expect(computeNextOffPeakDelayMs(now)).toBe(0);
  });

  it('calcule le délai exact jusqu’à 2h du matin', () => {
    // 23h -> 2h le lendemain = 3h de délai.
    const now = new Date(2026, 6, 12, 23, 0, 0);
    expect(computeNextOffPeakDelayMs(now)).toBe(3 * 60 * 60 * 1000);
  });

  it('délai toujours positif ou nul (jamais négatif)', () => {
    const now = new Date(2026, 6, 12, 1, 59, 59);
    expect(computeNextOffPeakDelayMs(now)).toBeGreaterThanOrEqual(0);
  });
});
