// Circuit breaker générique (Prompt 77 — mode dégradé). Enveloppe un appel
// externe instable (ElevenLabs, providers tiers…) pour éviter de marteler un
// service en panne : après `failureThreshold` échecs consécutifs, le breaker
// passe en 'open' et rejette immédiatement (sans exécuter `fn`) pendant
// `resetTimeoutMs` ; passé ce délai, un seul essai est autorisé ('half-open') —
// succès → retour à 'closed', échec → repasse en 'open' pour un nouveau délai.
//
// Chaque breaker nommé est enregistré dans un registre process-local (Map) et
// tient à jour un instantané en mémoire. Il est aussi persisté (best-effort)
// dans Redis à chaque transition d'état, sous la clé `circuit-breaker:<nom>`
// (même Redis que le reste du worker — pas de nouvelle infra) : c'est ce que
// lit l'admin web (page /admin, section « Résilience »), qui tourne dans un
// process séparé et n'a pas accès à la mémoire du worker.
import { logger } from '../queues/index.js';
import { getRedisConnection } from '../queues/connection.js';

/** Préfixe des clés Redis d'instantané de breaker (miroir lecture seule pour l'admin web). */
export const CIRCUIT_BREAKER_REDIS_PREFIX = 'circuit-breaker:';
/** TTL de l'instantané Redis — largement supérieur à tout resetTimeoutMs réaliste. */
const SNAPSHOT_TTL_SEC = 7 * 24 * 3600;

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Nombre d'échecs consécutifs avant ouverture du circuit. */
  failureThreshold: number;
  /** Délai avant de retenter (passage en half-open) une fois ouvert. */
  resetTimeoutMs: number;
}

/** Erreur jetée quand le circuit est ouvert : `fn` n'est PAS exécuté. */
export class CircuitOpenError extends Error {
  constructor(name: string, retryAt: number) {
    super(`circuit "${name}" ouvert — prochain essai à ${new Date(retryAt).toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitState;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  /** epoch ms du prochain essai autorisé (null si fermé ou jamais ouvert). */
  nextAttemptAt: number | null;
}

/**
 * Circuit breaker générique à états closed/open/half-open. Une instance par
 * dépendance externe (ex. `new CircuitBreaker('elevenlabs', {...})`) ; le
 * constructeur enregistre automatiquement l'instance dans le registre global
 * pour l'exposition admin (voir listCircuitBreakers ci-dessous).
 */
export class CircuitBreaker {
  readonly name: string;
  private readonly options: CircuitBreakerOptions;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private nextAttemptAt: number | null = null;

  constructor(name: string, options: CircuitBreakerOptions) {
    this.name = name;
    this.options = options;
    registry.set(name, this);
  }

  /** Horloge injectable (tests à fake timers) — Date.now() par défaut. */
  private now(): number {
    return Date.now();
  }

  /**
   * Exécute `fn` en respectant l'état courant du circuit :
   * - closed   : exécute normalement, comptabilise les échecs.
   * - open     : rejette immédiatement avec CircuitOpenError (tant que
   *              resetTimeoutMs n'est pas écoulé) — `fn` n'est jamais appelée.
   * - half-open (délai écoulé) : un seul essai ; succès → closed, échec → open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const now = this.now();
      if (this.nextAttemptAt !== null && now < this.nextAttemptAt) {
        throw new CircuitOpenError(this.name, this.nextAttemptAt);
      }
      // Délai écoulé : on autorise un essai unique (half-open).
      this.state = 'half-open';
      logger.info({ breaker: this.name }, 'circuit breaker : passage half-open (essai unique)');
      void this.persistSnapshot();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private onSuccess(): void {
    const wasNotClosed = this.state !== 'closed';
    if (wasNotClosed) {
      logger.info({ breaker: this.name }, 'circuit breaker : fermeture (essai réussi)');
    }
    this.state = 'closed';
    this.failureCount = 0;
    this.nextAttemptAt = null;
    if (wasNotClosed) void this.persistSnapshot();
  }

  private onFailure(err: unknown): void {
    this.failureCount += 1;
    this.lastError = err instanceof Error ? err.message : String(err);
    this.lastErrorAt = this.now();

    if (this.state === 'half-open') {
      // L'essai unique en half-open a échoué : ré-ouverture immédiate.
      this.open();
      return;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = 'open';
    this.nextAttemptAt = this.now() + this.options.resetTimeoutMs;
    logger.warn(
      { breaker: this.name, failureCount: this.failureCount, nextAttemptAt: this.nextAttemptAt },
      'circuit breaker : ouverture',
    );
    void this.persistSnapshot();
  }

  /** Persiste l'instantané courant dans Redis (best-effort, jamais bloquant). */
  private async persistSnapshot(): Promise<void> {
    try {
      const redis = getRedisConnection();
      await redis.set(
        `${CIRCUIT_BREAKER_REDIS_PREFIX}${this.name}`,
        JSON.stringify(this.snapshot()),
        'EX',
        SNAPSHOT_TTL_SEC,
      );
    } catch (err) {
      logger.warn({ breaker: this.name, err }, 'circuit breaker : persistance Redis impossible');
    }
  }

  /** Instantané sérialisable pour l'admin. */
  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      nextAttemptAt: this.nextAttemptAt,
    };
  }

  /** Remet le breaker à l'état initial (tests). */
  resetForTests(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastError = null;
    this.lastErrorAt = null;
    this.nextAttemptAt = null;
  }
}

// ── Registre global (process-local) ─────────────────────────────
const registry = new Map<string, CircuitBreaker>();

/** Liste des instantanés de tous les breakers enregistrés (pour /admin). */
export function listCircuitBreakers(): CircuitBreakerSnapshot[] {
  return [...registry.values()].map((b) => b.snapshot()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Réinitialise le registre (tests uniquement). */
export function resetCircuitBreakerRegistryForTests(): void {
  registry.clear();
}
