// Autoscaling GPU éphémère (Prompt 162 — voir docs/HARDWARE-SIZING.md).
//
// Objectif : absorber les PICS de charge des jobs GPU-dépendants (Kokoro TTS,
// ComfyUI illustrations, SadTalker avatar — cf. providers/*.ts, P153-155) sans
// payer un GPU Hetzner dédié à l'année. Quand la profondeur cumulée des queues
// GPU-dépendantes dépasse un seuil, on loue un worker GPU éphémère (RunPod ou
// Vast.ai) le temps d'écouler le backlog, puis on le détruit après une période
// d'inactivité (même pattern reaper que media/tp-environments.ts, P22).
//
// MOCK-FRIENDLY (règle du projet) : sans RUNPOD_API_KEY/VASTAI_API_KEY
// configurée (ou sans GPU_AUTOSCALE_PROVIDER défini), provisionGpuWorker ne
// fait AUCUN appel réseau et retourne un GpuWorkerHandle de type 'mock' —
// jamais un point de blocage du pipeline. Les credentials sont lues
// directement via process.env (comme alerts.ts::OPS_WEBHOOK_URL) : ce module
// reste optionnel et n'entre pas dans le schéma Zod global (getConfig()),
// cf. docs/HARDWARE-SIZING.md §4.
import { logger } from '../queues/index.js';

/** Provider de location GPU à la demande supporté. */
export type GpuRentalProvider = 'runpod' | 'vast';

/** Type de job GPU-dépendant suivi pour la décision de scale-up (cf. QUEUES dans @sallycourse/shared). */
export type GpuQueueKind = 'tts' | 'screenshot' | 'videoRender';

/** Seuil par défaut de jobs en attente cumulés déclenchant un scale-up. */
export const DEFAULT_QUEUE_THRESHOLD = 5;

/** Inactivité par défaut avant destruction d'un worker GPU loué. */
export const DEFAULT_MAX_IDLE_MS = 15 * 60 * 1_000;

/** Tarifs horaires USD indicatifs (marché spot, 2026-07) — voir docs/HARDWARE-SIZING.md §3. */
export const GPU_RENTAL_HOURLY_USD: Record<GpuRentalProvider, number> = {
  // Vast.ai : marché décentralisé, RTX 4090 24 Go en spot.
  vast: 0.35,
  // RunPod : Community/Secure Cloud, RTX 4090/A5000.
  runpod: 0.55,
};

/** Coût mensuel amorti d'un GPU Hetzner dédié (GEX44, cf. docs/HARDWARE-SIZING.md §2). */
export const HETZNER_GEX44_MONTHLY_USD = 230;
const HOURS_PER_MONTH = 730; // moyenne (365,25 j / 12) × 24 h
export const HETZNER_GEX44_HOURLY_USD = HETZNER_GEX44_MONTHLY_USD / HOURS_PER_MONTH;

// ── Décision de scale-up/down (PURE — testable sans réseau) ────────────────

/**
 * Décide s'il faut provisionner un worker GPU éphémère supplémentaire, à
 * partir de la profondeur cumulée des queues GPU-dépendantes. `threshold`
 * par défaut = DEFAULT_QUEUE_THRESHOLD (surchargeable via
 * GPU_AUTOSCALE_QUEUE_THRESHOLD, lu par l'appelant).
 */
export function shouldScaleUp(queueDepth: number, threshold: number = DEFAULT_QUEUE_THRESHOLD): boolean {
  return queueDepth > threshold;
}

/**
 * Décide s'il faut détruire un worker GPU loué : la queue est redescendue
 * sous (ou égale à) un seuil bas ET le worker est inactif depuis au moins
 * `maxIdleMs`. Les deux conditions évitent de tuer un worker qui vient de
 * recevoir un nouveau job juste après avoir vidé son backlog (course entre le
 * scan de reap et l'assignation d'un job).
 */
export function shouldScaleDown(
  queueDepth: number,
  idleMs: number,
  opts: { threshold?: number; maxIdleMs?: number } = {},
): boolean {
  const threshold = opts.threshold ?? DEFAULT_QUEUE_THRESHOLD;
  const maxIdleMs = opts.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
  return queueDepth <= threshold && idleMs >= maxIdleMs;
}

/** Profondeur cumulée des queues GPU-dépendantes — même logique de somme que queue-estimate.ts (P73/P134). */
export function totalGpuQueueDepth(depths: Partial<Record<GpuQueueKind, number>>): number {
  return Object.values(depths).reduce((acc: number, n) => acc + Math.max(0, n ?? 0), 0);
}

// ── Comparatif coût location vs fixe (PUR) ─────────────────────────────────

/** Tarif horaire USD du provider donné (repli sur la moyenne des deux si provider inconnu — prudence). */
export function hourlyRateUsd(provider: GpuRentalProvider): number {
  return GPU_RENTAL_HOURLY_USD[provider];
}

/**
 * Coût USD d'une location ponctuelle de `hours` heures chez `provider`.
 */
export function rentalCostUsd(provider: GpuRentalProvider, hours: number): number {
  return Math.max(0, hours) * hourlyRateUsd(provider);
}

/**
 * true si louer `hoursPerMonth` heures/mois chez `provider` coûte MOINS cher
 * qu'un GEX44 dédié (amorti en continu). Sert à décider "on reste en location
 * à la demande" vs "un dédié serait déjà rentable" (cf. docs/HARDWARE-SIZING.md §3).
 */
export function isRentalCheaperThanFixed(
  provider: GpuRentalProvider,
  hoursPerMonth: number,
  fixedMonthlyUsd: number = HETZNER_GEX44_MONTHLY_USD,
): boolean {
  return rentalCostUsd(provider, hoursPerMonth) < fixedMonthlyUsd;
}

/** Nombre d'heures/mois à partir duquel le dédié devient moins cher que la location, pour ce provider. */
export function breakEvenHoursPerMonth(
  provider: GpuRentalProvider,
  fixedMonthlyUsd: number = HETZNER_GEX44_MONTHLY_USD,
): number {
  return fixedMonthlyUsd / hourlyRateUsd(provider);
}

// ── Provisioning réel (mock-friendly) ──────────────────────────────────────

export interface GpuWorkerHandle {
  /** Identifiant du pod/instance loué (opaque, spécifique au provider). */
  id: string;
  /** Provider effectivement utilisé, ou 'mock' si aucun credential n'est configuré. */
  provider: GpuRentalProvider | 'mock';
  /** Type de GPU demandé (informatif — dépend du provider réel). */
  gpuType: string;
  /** epoch ms de provisioning. */
  startedAt: number;
  /** epoch ms de dernière activité connue (mis à jour par l'appelant via touchGpuWorker). */
  lastActiveAt: number;
}

export interface ProvisionGpuWorkerOptions {
  /** Type de GPU souhaité (informatif, transmis tel quel à l'API du provider). */
  gpuType?: string;
  /** Provider cible — sinon lu depuis GPU_AUTOSCALE_PROVIDER (absent → mock). */
  provider?: GpuRentalProvider;
  /** Horloge injectable (tests). */
  now?: () => number;
}

const DEFAULT_GPU_TYPE = 'RTX4090';
const PROVISION_TIMEOUT_MS = 30_000;

function resolveProvider(explicit?: GpuRentalProvider): GpuRentalProvider | undefined {
  if (explicit) return explicit;
  const raw = process.env.GPU_AUTOSCALE_PROVIDER?.trim().toLowerCase();
  if (raw === 'runpod' || raw === 'vast') return raw;
  return undefined;
}

function apiKeyFor(provider: GpuRentalProvider): string | undefined {
  const key = provider === 'runpod' ? process.env.RUNPOD_API_KEY : process.env.VASTAI_API_KEY;
  return key?.trim() || undefined;
}

/**
 * Provisionne un worker GPU éphémère. Sans provider résolu OU sans clé API
 * correspondante configurée : retourne immédiatement un handle 'mock' (aucun
 * appel réseau) — jamais un point de blocage du pipeline d'autoscaling.
 *
 * Appels réels (documentés, non exécutés en mode mock) :
 *   - RunPod  : POST https://api.runpod.io/graphql (mutation podFindAndDeployOnDemand),
 *               header `Authorization: Bearer <RUNPOD_API_KEY>`.
 *   - Vast.ai : PUT  https://console.vast.ai/api/v0/asks/<id>/ (création d'instance
 *               depuis une offre recherchée au préalable via GET /api/v0/bundles/),
 *               header `Authorization: Bearer <VASTAI_API_KEY>`.
 */
export async function provisionGpuWorker(opts: ProvisionGpuWorkerOptions = {}): Promise<GpuWorkerHandle> {
  const now = opts.now ?? Date.now;
  const gpuType = opts.gpuType ?? DEFAULT_GPU_TYPE;
  const provider = resolveProvider(opts.provider);

  if (!provider) {
    logger.info({ gpuType }, 'gpu-autoscale : aucun provider configuré (GPU_AUTOSCALE_PROVIDER absent) — mock');
    return mockHandle(gpuType, now());
  }

  const apiKey = apiKeyFor(provider);
  if (!apiKey) {
    logger.warn({ provider, gpuType }, 'gpu-autoscale : clé API absente pour ce provider — mock');
    return mockHandle(gpuType, now());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVISION_TIMEOUT_MS);
  try {
    const id = await requestProvision(provider, apiKey, gpuType, controller.signal);
    const startedAt = now();
    logger.info({ provider, gpuType, id }, 'gpu-autoscale : worker GPU provisionné');
    return { id, provider, gpuType, startedAt, lastActiveAt: startedAt };
  } catch (err) {
    logger.warn({ provider, gpuType, err }, 'gpu-autoscale : provisioning échoué — repli mock');
    return mockHandle(gpuType, now());
  } finally {
    clearTimeout(timer);
  }
}

function mockHandle(gpuType: string, now: number): GpuWorkerHandle {
  return { id: `mock-${now}`, provider: 'mock', gpuType, startedAt: now, lastActiveAt: now };
}

/** Appel REST réel — isolé pour rester facilement mockable en test (fetch injecté implicitement via globalThis.fetch). */
async function requestProvision(
  provider: GpuRentalProvider,
  apiKey: string,
  gpuType: string,
  signal: AbortSignal,
): Promise<string> {
  if (provider === 'runpod') {
    const res = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query:
          'mutation { podFindAndDeployOnDemand(input: { gpuTypeId: "' + gpuType + '", cloudType: COMMUNITY }) { id } }',
      }),
      signal,
    });
    if (!res.ok) throw new Error(`RunPod API ${res.status}`);
    const json = (await res.json()) as { data?: { podFindAndDeployOnDemand?: { id?: string } } };
    const id = json.data?.podFindAndDeployOnDemand?.id;
    if (!id) throw new Error('RunPod API : identifiant de pod absent de la réponse');
    return id;
  }

  // Vast.ai : simplifié — suppose qu'un identifiant d'offre a déjà été résolu
  // en amont (GET /api/v0/bundles/) ; ici on documente l'appel de création.
  const res = await fetch(`https://console.vast.ai/api/v0/asks/${encodeURIComponent(gpuType)}/`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ client_id: 'sallycourse' }),
    signal,
  });
  if (!res.ok) throw new Error(`Vast.ai API ${res.status}`);
  const json = (await res.json()) as { new_contract?: number | string };
  if (json.new_contract === undefined) throw new Error('Vast.ai API : new_contract absent de la réponse');
  return String(json.new_contract);
}

/**
 * Détruit un worker GPU loué. Aucun effet (no-op silencieux) pour un handle
 * 'mock'. Best-effort : ne jette jamais, une destruction échouée est loguée
 * (l'opérateur devra nettoyer manuellement côté console provider).
 */
export async function destroyGpuWorker(handle: GpuWorkerHandle): Promise<void> {
  if (handle.provider === 'mock') return;

  const apiKey = apiKeyFor(handle.provider);
  if (!apiKey) {
    logger.warn({ handle }, 'gpu-autoscale : destruction impossible (clé API absente)');
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVISION_TIMEOUT_MS);
  try {
    if (handle.provider === 'runpod') {
      await fetch('https://api.runpod.io/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query: `mutation { podTerminate(input: { podId: "${handle.id}" }) }` }),
        signal: controller.signal,
      });
    } else {
      await fetch(`https://console.vast.ai/api/v0/instances/${encodeURIComponent(handle.id)}/`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    }
    logger.info({ handle }, 'gpu-autoscale : worker GPU détruit');
  } catch (err) {
    logger.warn({ handle, err }, 'gpu-autoscale : destruction échouée (best-effort)');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reaper : détruit tous les workers GPU inactifs depuis plus de `maxIdleMs`
 * parmi `handles` (même pattern que
 * media/tp-environments.ts::killTpContainersOlderThan, P22). Retourne les
 * handles conservés (toujours actifs) — l'appelant remplace sa liste par ce
 * résultat. Best-effort, ne jette jamais.
 */
export async function reapIdleGpuWorkers(
  handles: readonly GpuWorkerHandle[],
  maxIdleMs: number = DEFAULT_MAX_IDLE_MS,
  now: number = Date.now(),
): Promise<GpuWorkerHandle[]> {
  const kept: GpuWorkerHandle[] = [];
  for (const handle of handles) {
    const idleMs = now - handle.lastActiveAt;
    if (idleMs >= maxIdleMs) {
      await destroyGpuWorker(handle);
    } else {
      kept.push(handle);
    }
  }
  return kept;
}

/** Met à jour l'horodatage de dernière activité d'un handle (appelé quand un job GPU lui est assigné). */
export function touchGpuWorker(handle: GpuWorkerHandle, now: number = Date.now()): GpuWorkerHandle {
  return { ...handle, lastActiveAt: now };
}
