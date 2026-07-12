// LLM OSS local (Prompt 152) — Ollama, API REST (/api/generate, /api/tags).
//
// Rôle : alternative gratuite à callClaudeJson (claude.ts) pour les tâches non
// critiques (résumés P19, tags, alt-text P137), avec escalade automatique vers
// le cloud (callClaudeJson réel) si la qualité Ollama est insuffisante, ou vers
// mock-fixtures si aucune clé Anthropic n'est disponible — jamais d'échec
// silencieux du pipeline.
//
// Mode hybride : `critical: true` force directement le cloud (plan/scripts,
// où la qualité prime sur le coût) sans solliciter Ollama du tout.
//
// Détection GPU : si OLLAMA_HAS_GPU est explicitement défini (.env, tests, CI),
// on fait confiance à cette valeur (true OU false) sans requête réseau ; sinon
// on interroge /api/tags et on regarde si un modèle « lourd » (70b/72b) est
// déjà tiré localement (heuristique simple — Ollama n'expose pas nativement
// les capacités matérielles de l'hôte via son API REST).
import { z } from 'zod';
import { getConfig } from '../shared.js';
import { logger } from '../queues/index.js';
import { mockFixtureFor } from '../lib/mock-fixtures.js';
import { callClaudeJson, extractJsonPayload, type CallClaudeJsonParams } from '../lib/claude.js';

/** Modèles recommandés par tâche (Prompt 152) — surchargeables via .env. */
export const OLLAMA_MODELS = {
  /** Tâches critiques avec GPU disponible : plan de cours, scripts vidéo. */
  criticalGpu: 'llama3.3:70b',
  /** Alternative qualité équivalente (GPU), au choix de l'opérateur. */
  criticalGpuAlt: 'qwen2.5:72b',
  /** Tâches simples (résumés, tags, alt-text) — raisonnable en CPU. */
  simple: 'qwen2.5:14b',
  /** Repli le plus léger si ni GPU ni modèle 14b tiré. */
  simpleLight: 'llama3.2:8b',
} as const;

/** Nombre d'échecs de validation Zod avant escalade cloud (Prompt 152). */
export const MAX_OLLAMA_ATTEMPTS = 3;

/** URL de base Ollama, surchargeable (.env / mock-server en test). */
function ollamaBaseUrl(): string | undefined {
  const raw = getConfig().OLLAMA_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/+$/, '') : undefined;
}

/** true si un endpoint Ollama est configuré ET que le mode mock global n'est pas actif. */
export function isOllamaConfigured(): boolean {
  const cfg = getConfig();
  return !cfg.MOCK_PROVIDERS && Boolean(ollamaBaseUrl());
}

/**
 * Détecte la présence d'un GPU exploitable par Ollama : OLLAMA_HAS_GPU force
 * la réponse sans appel réseau (tests, CI, machine connue) ; sinon interroge
 * /api/tags et considère qu'un GPU est disponible si un modèle 70b/72b est
 * déjà tiré localement (un modèle aussi lourd est peu réaliste en pur CPU).
 * Retourne false si Ollama est injoignable — jamais bloquant.
 */
export async function detectOllamaGpu(): Promise<boolean> {
  const cfg = getConfig();
  // OLLAMA_HAS_GPU explicitement défini dans l'environnement : on fait
  // confiance à la valeur telle quelle (true OU false), sans requête réseau.
  if ('OLLAMA_HAS_GPU' in process.env && process.env.OLLAMA_HAS_GPU?.trim()) {
    return cfg.OLLAMA_HAS_GPU;
  }

  const base = ollamaBaseUrl();
  if (!base) return false;

  try {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: { name?: string }[] };
    const names = (body.models ?? []).map((m) => m.name ?? '');
    return names.some((name) => /70b|72b/i.test(name));
  } catch (err) {
    logger.debug({ err }, 'detectOllamaGpu : /api/tags injoignable — GPU non détecté');
    return false;
  }
}

/**
 * Modèle Ollama recommandé pour une tâche donnée : `critical` choisit entre
 * les modèles qualité (GPU) ou leur repli CPU-raisonnable ; sinon les modèles
 * « simples » (résumés/tags/alt-text). Les surcharges .env (OLLAMA_MODEL_*)
 * priment toujours sur les recommandations par défaut.
 */
export async function recommendedOllamaModel(critical: boolean): Promise<string> {
  const cfg = getConfig();
  if (critical && cfg.OLLAMA_MODEL_CRITICAL) return cfg.OLLAMA_MODEL_CRITICAL;
  if (!critical && cfg.OLLAMA_MODEL_SIMPLE) return cfg.OLLAMA_MODEL_SIMPLE;

  const hasGpu = await detectOllamaGpu();
  if (critical) return hasGpu ? OLLAMA_MODELS.criticalGpu : OLLAMA_MODELS.simple;
  return hasGpu ? OLLAMA_MODELS.simple : OLLAMA_MODELS.simpleLight;
}

/** Corps de la requête POST /api/generate — format JSON forcé (paramètre natif Ollama). */
export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system: string;
  format: 'json';
  stream: false;
  options?: { temperature?: number };
}

/** Construit la requête Ollama (pure, testable sans réseau) — system+user → /api/generate. */
export function buildOllamaRequest(model: string, system: string, user: string, temperature?: number): OllamaGenerateRequest {
  return {
    model,
    prompt: user,
    system,
    format: 'json',
    stream: false,
    ...(temperature !== undefined ? { options: { temperature } } : {}),
  };
}

/** Réponse /api/generate (non-stream) : le JSON généré est dans `response` (texte brut). */
interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

/** Appelle /api/generate et retourne la charge JSON brute (texte, non encore validé). */
async function ollamaGenerateRaw(base: string, request: OllamaGenerateRequest): Promise<string> {
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Ollama ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = (await res.json()) as OllamaGenerateResponse;
  return body.response;
}

export interface CallOllamaJsonParams<T> {
  /** Schéma Zod attendu — mêmes garanties que callClaudeJson. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Input volontairement libre, voir claude.ts.
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  /** Prompt système (règles, format de sortie). */
  system: string;
  /** Message utilisateur (données de la tâche). */
  user: string;
  /**
   * Tâche critique (plan de cours, scripts vidéo) : force directement le cloud
   * (callClaudeJson réel) sans solliciter Ollama — qualité prioritaire sur le
   * coût pour ces générations structurantes du cours.
   */
  critical?: boolean;
  /** Modèle Ollama forcé — sinon déduit via recommendedOllamaModel(critical). */
  model?: string;
  /** Température (optionnel, transmise telle quelle à Ollama). */
  temperature?: number;
  /** Rattache le coût au cours si escalade cloud (Prompt 55) — voir CallClaudeJsonParams. */
  cost?: CallClaudeJsonParams<T>['cost'];
}

/**
 * Génère un JSON validé, en préférant Ollama (gratuit, local) sauf tâche
 * critique. Chaîne de repli complète :
 * 1. `critical: true` → callClaudeJson directement (cloud si clé, sinon mock).
 * 2. Ollama non configuré (MOCK_PROVIDERS ou OLLAMA_BASE_URL absente) →
 *    callClaudeJson (donc cloud si clé dispo, sinon mock-fixtures — jamais
 *    d'échec silencieux).
 * 3. Ollama configuré : jusqu'à MAX_OLLAMA_ATTEMPTS tentatives (réinjection du
 *    feedback de validation Zod comme callClaudeJson). Si la validation échoue
 *    toujours après MAX_OLLAMA_ATTEMPTS essais → escalade vers callClaudeJson
 *    (cloud réel si ANTHROPIC_API_KEY existe, sinon mock-fixtures).
 */
export async function callOllamaJson<T>(params: CallOllamaJsonParams<T>): Promise<T> {
  const { schema, system, user, critical = false, temperature, cost } = params;

  if (critical) {
    logger.debug('callOllamaJson : tâche critique — cloud direct (Ollama non sollicité)');
    return callClaudeJson({ schema, system, user, temperature, cost });
  }

  if (!isOllamaConfigured()) {
    logger.debug('callOllamaJson : Ollama non configuré — repli callClaudeJson (cloud ou mock)');
    return callClaudeJson({ schema, system, user, temperature, cost });
  }

  const base = ollamaBaseUrl()!;
  const model = params.model ?? (await recommendedOllamaModel(false));

  let lastIssues = '';
  for (let attempt = 1; attempt <= MAX_OLLAMA_ATTEMPTS; attempt++) {
    const promptUser =
      attempt === 1
        ? user
        : `${user}\n\nTa réponse précédente ne respectait pas le schéma attendu. Erreurs :\n${lastIssues}\n` +
          `Corrige ces erreurs et réponds UNIQUEMENT avec le JSON complet corrigé.`;

    let raw: string;
    try {
      raw = await ollamaGenerateRaw(base, buildOllamaRequest(model, system, promptUser, temperature));
    } catch (err) {
      // Service local injoignable (down, pas encore démarré) : pas la peine de
      // retenter — on escalade immédiatement (cloud si clé, sinon mock).
      logger.warn({ err, model }, 'callOllamaJson : Ollama injoignable — escalade cloud/mock');
      return callClaudeJson({ schema, system, user, temperature, cost });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonPayload(raw));
    } catch (err) {
      lastIssues = `JSON invalide : ${(err as Error).message}`;
      logger.warn({ model, attempt, issues: lastIssues }, 'callOllamaJson : parsing JSON échoué');
      continue;
    }

    const validated = schema.safeParse(parsedJson);
    if (validated.success) return validated.data;

    lastIssues = validated.error.issues
      .map((issue) => `- ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    logger.warn({ model, attempt, issues: lastIssues }, 'callOllamaJson : validation Zod échouée');
  }

  // Qualité Ollama insuffisante après MAX_OLLAMA_ATTEMPTS essais : escalade
  // vers callClaudeJson RÉEL si une clé Anthropic existe, sinon mock-fixtures
  // (callClaudeJson gère déjà ce choix en interne — jamais d'échec silencieux).
  logger.warn(
    { model, attempts: MAX_OLLAMA_ATTEMPTS },
    'callOllamaJson : qualité insuffisante après plusieurs tentatives — escalade cloud/mock',
  );
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDERS || !cfg.ANTHROPIC_API_KEY) {
    // Évite un aller-retour réseau supplémentaire côté callClaudeJson : mock direct.
    return mockFixtureFor(schema, user);
  }
  return callClaudeJson({ schema, system, user, temperature, cost, skipCache: true });
}
