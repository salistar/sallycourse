import { describe, expect, it } from 'vitest';
import { degradedCount, severityOf, sortBreakers, type CircuitBreakerSnapshot } from './breaker-view';

function snap(overrides: Partial<CircuitBreakerSnapshot> = {}): CircuitBreakerSnapshot {
  return {
    name: 'x',
    state: 'closed',
    failureCount: 0,
    lastError: null,
    lastErrorAt: null,
    nextAttemptAt: null,
    ...overrides,
  };
}

describe('severityOf', () => {
  it('mappe open → critical, half-open → warning, closed → ok', () => {
    expect(severityOf('open')).toBe('critical');
    expect(severityOf('half-open')).toBe('warning');
    expect(severityOf('closed')).toBe('ok');
  });
});

describe('sortBreakers', () => {
  it('place les breakers open en premier, puis half-open, puis closed', () => {
    const input = [
      snap({ name: 'c', state: 'closed' }),
      snap({ name: 'o', state: 'open' }),
      snap({ name: 'h', state: 'half-open' }),
    ];
    expect(sortBreakers(input).map((s) => s.name)).toEqual(['o', 'h', 'c']);
  });

  it('trie alphabétiquement à état égal', () => {
    const input = [snap({ name: 'zebra', state: 'open' }), snap({ name: 'alpha', state: 'open' })];
    expect(sortBreakers(input).map((s) => s.name)).toEqual(['alpha', 'zebra']);
  });

  it('ne modifie pas le tableau original', () => {
    const input = [snap({ name: 'b', state: 'open' }), snap({ name: 'a', state: 'closed' })];
    const copy = [...input];
    sortBreakers(input);
    expect(input).toEqual(copy);
  });
});

describe('degradedCount', () => {
  it('compte les breakers open et half-open, ignore closed', () => {
    const input = [
      snap({ state: 'open' }),
      snap({ state: 'half-open' }),
      snap({ state: 'closed' }),
      snap({ state: 'closed' }),
    ];
    expect(degradedCount(input)).toBe(2);
  });

  it('retourne 0 si tout est fermé ou liste vide', () => {
    expect(degradedCount([snap({ state: 'closed' })])).toBe(0);
    expect(degradedCount([])).toBe(0);
  });
});
