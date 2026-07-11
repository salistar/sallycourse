// Dérivation PURE de l'affichage des circuit breakers (Prompt 77) — aucune
// dépendance réseau ici (lue par read-circuit-breakers.ts, testée séparément).
// Miroir du type CircuitBreakerSnapshot côté worker (apps/worker/src/lib/circuit-breaker.ts).

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitState;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  nextAttemptAt: number | null;
}

/** Sévérité d'affichage (couleur du badge) associée à l'état du breaker. */
export type BreakerSeverity = 'ok' | 'warning' | 'critical';

export function severityOf(state: CircuitState): BreakerSeverity {
  if (state === 'open') return 'critical';
  if (state === 'half-open') return 'warning';
  return 'ok';
}

/** Trie les breakers : ouverts d'abord, puis half-open, puis fermés — alphabétique à état égal. */
export function sortBreakers(snapshots: readonly CircuitBreakerSnapshot[]): CircuitBreakerSnapshot[] {
  const rank: Record<CircuitState, number> = { open: 0, 'half-open': 1, closed: 2 };
  return [...snapshots].sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
}

/** Nombre de breakers actuellement ouverts ou half-open (incident en cours). */
export function degradedCount(snapshots: readonly CircuitBreakerSnapshot[]): number {
  return snapshots.filter((s) => s.state !== 'closed').length;
}
