// Client Anthropic réutilisable : appel JSON structuré + validation Zod,
// retry avec réinjection des erreurs de validation, détection de troncature.
// MOCK_PROVIDERS=true (ou clé absente) court-circuite tout appel payant.
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { getConfig } from '../shared.js';
import { logger } from '../queues/index.js';
import { mockFixtureFor } from './mock-fixtures.js';
import { recordClaudeCost, type CostContext } from './cost.js';
import { getOrCompute, hashCacheKey } from './cache.js';

/** Modèle par défaut du pipeline de génération. */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
/** Nombre maximal de tentatives (appel initial + retries de validation). */
export const MAX_JSON_ATTEMPTS = 3;
const DEFAULT_MAX_TOKENS = 8192;
/**
 * Prompt 77 — mode dégradé : file d'attente locale (pas de nouvelle infra) sur
 * 429 répétés. `client.messages.create` est déjà retry-friendly côté SDK
 * (backoff interne par défaut), mais un 429 persistant remontait tel quel et
 * faisait échouer tout le job. On ajoute ici un délai croissant AVANT chaque
 * nouvel essai, borné à MAX_RATE_LIMIT_RETRIES tentatives supplémentaires.
 */
export const MAX_RATE_LIMIT_RETRIES = 4;
/** Délai de base du backoff croissant sur 429 (doublé à chaque tentative). */
export const RATE_LIMIT_BASE_DELAY_MS = 1_000;
/** Durée de vie du cache des appels Claude (Prompt 72) — 30 jours. */
export const CLAUDE_CACHE_TTL_SEC = 30 * 24 * 3600;
/** Préfixe des clés de cache Claude dans Redis. */
const CLAUDE_CACHE_PREFIX = 'cache:claude:';

/** Clé de cache déterministe pour un appel Claude : hash(system+user+model). */
export function claudeCacheKey(system: string, user: string, model: string): string {
  return `${CLAUDE_CACHE_PREFIX}${hashCacheKey(system, user, model)}`;
}

export interface CallClaudeJsonParams<T> {
  /**
   * Schéma Zod attendu — la valeur retournée est garantie conforme.
   * `Input` volontairement libre (`any`) : les schémas avec `.default()` ont un
   * type d'entrée distinct du type de sortie `T`, ce qui rendrait `z.ZodType<T>`
   * (Input=T par défaut) incompatible avec ces schémas sans cette relaxation.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Input volontairement libre : voir doc ci-dessus (schémas `.default()`).
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  /** Prompt système (règles, format de sortie). */
  system: string;
  /** Message utilisateur (données de la tâche). */
  user: string;
  /** Modèle Anthropic (défaut : claude-sonnet-5). */
  model?: string;
  /** Budget de tokens de sortie (défaut : 8192, non-streaming). */
  maxTokens?: number;
  /** Optionnel — les modèles récents (Sonnet 5+) rejettent les valeurs non par défaut. */
  temperature?: number;
  /** Optionnel — rattache le coût (tokens in/out) à un cours (Prompt 55). */
  cost?: CostContext;
  /**
   * Prompt 72 — désactive le cache Redis pour CET appel (défaut : false).
   * À utiliser pour les tentatives ≥2 des boucles de retry MÉTIER qui
   * réinjectent le même feedback textuel (article/marketing/quiz/tp/
   * video-script) : sans ce drapeau, la 2e tentative rejouerait le même
   * hash(system+user+model) que la 1re, et le retry ne convergerait jamais
   * (toujours la même réponse invalide servie depuis le cache).
   */
  skipCache?: boolean;
  /**
   * Provider LLM choisi pour CE cours (course.llmProvider) : id du catalogue
   * cloud (voir providers/cloud-llm.ts — 'gemini', 'deepseek'…), ou 'anthropic'
   * / 'ollama' pour forcer ces chemins. Absent → cascade coût par défaut
   * (cloud gratuit → Anthropic → Ollama → mock).
   */
  llmProviderId?: string | null;
}

/** Erreur enrichie : tentatives effectuées, dernière sortie brute, issues Zod. */
export class ClaudeJsonError extends Error {
  readonly attempts: number;
  readonly lastRaw?: string;
  readonly issues?: string;

  constructor(message: string, opts: { attempts: number; lastRaw?: string; issues?: string } = { attempts: 0 }) {
    super(message);
    this.name = 'ClaudeJsonError';
    this.attempts = opts.attempts;
    this.lastRaw = opts.lastRaw;
    this.issues = opts.issues;
  }
}

// Client singleton — instancié au premier appel réel (jamais en mode mock).
let anthropicClient: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (!anthropicClient) {
    // Surcharge optionnelle de l'URL de base (mock-server / proxy local).
    // Rétrocompatible : absente → SDK vers api.anthropic.com par défaut.
    const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
    anthropicClient = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey });
  }
  return anthropicClient;
}

/** Réinitialise le singleton (tests). */
export function resetClaudeClientForTests(): void {
  anthropicClient = null;
}

/**
 * Extrait la charge JSON d'une réponse LLM : gère les fences ```json … ```,
 * le texte d'accompagnement, et retombe sur le premier bloc {…} ou […].
 *
 * PIÈGE (corrigé) : un article contient son PROPRE Markdown avec des blocs de
 * code ```bash…```. Certains providers (Gemini, Zhipu, Qwen…) emballent leur
 * JSON dans un fence ```json (Claude, lui, renvoie du JSON nu). Une regex de
 * fence NON-GREEDY tronquait alors le JSON au PREMIER ``` interne → JSON invalide
 * → échec systématique de génération d'articles. On retire donc le fence
 * ENGLOBANT (ligne d'ouverture + DERNIER ```), jamais un fence interne.
 */
export function extractJsonPayload(raw: string): string {
  let s = raw.trim();

  // Fence englobant en TÊTE de réponse : retire la ligne d'ouverture (```json /
  // ```) et le DERNIER ``` (clôture) — les ```…``` internes au JSON sont préservés.
  if (s.startsWith('```')) {
    s = s.replace(/^```[^\n]*\r?\n?/, '');
    const lastFence = s.lastIndexOf('```');
    if (lastFence >= 0) s = s.slice(0, lastFence);
    s = s.trim();
  }

  // Première ouverture {…} ou […] — JSON nu OU noyé dans du texte.
  const firstBrace = s.search(/[[{]/);
  if (firstBrace < 0) return s;

  // Extraction ÉQUILIBRÉE de la 1re valeur complète : ignore tout ce qui SUIT
  // (2e objet, prose de fin, ``` de clôture) qui faisait échouer JSON.parse
  // (« Unexpected non-whitespace character after JSON »). Respecte les chaînes
  // et les échappements → les ```…``` internes au JSON restent intacts.
  const balanced = sliceFirstBalancedJson(s, firstBrace);
  if (balanced !== null) return balanced;

  // Repli (réponse vraisemblablement tronquée : valeur jamais refermée) :
  // première ouverture → dernière fermeture, meilleur-effort.
  const open = s[firstBrace]!;
  const close = open === '{' ? '}' : ']';
  const lastClose = s.lastIndexOf(close);
  return lastClose > firstBrace ? s.slice(firstBrace, lastClose + 1) : s.slice(firstBrace);
}

/**
 * Extrait la PREMIÈRE valeur JSON équilibrée ({…} ou […]) à partir de `startIdx`,
 * en respectant chaînes et échappements — ignore donc tout texte APRÈS la valeur
 * (2e objet, explication de fin, ``` de clôture) qui faisait échouer JSON.parse.
 * Ne compte qu'un seul type de délimiteur (celui d'ouverture) : suffisant pour
 * du JSON bien formé (un `]` ne peut pas fermer prématurément un objet, ni
 * inversement). Retourne null si la valeur ne se referme jamais (tronquée).
 */
export function sliceFirstBalancedJson(s: string, startIdx: number): string | null {
  const open = s[startIdx];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return null;
}

/** Vrai si l'erreur SDK est un 429 (rate limit) — détection structurelle (pas d'instanceof, évite un couplage dur au SDK dans les tests). */
export function isRateLimitError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 429;
}

/** Attente asynchrone — isolée pour rester mockable/contrôlable par fake timers. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enveloppe `client.messages.create` d'un backoff croissant local sur 429
 * répétés : 1s, 2s, 4s, 8s (RATE_LIMIT_BASE_DELAY_MS doublé à chaque tentative),
 * jusqu'à MAX_RATE_LIMIT_RETRIES tentatives supplémentaires. Toute autre erreur
 * (ou 429 persistant au-delà du budget) est rejetée telle quelle.
 */
async function createWithRateLimitBackoff(
  client: Anthropic,
  request: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  let lastErr: unknown;
  for (let retry = 0; retry <= MAX_RATE_LIMIT_RETRIES; retry++) {
    try {
      return await client.messages.create(request);
    } catch (err) {
      if (!isRateLimitError(err) || retry === MAX_RATE_LIMIT_RETRIES) throw err;
      lastErr = err;
      const delayMs = RATE_LIMIT_BASE_DELAY_MS * 2 ** retry;
      logger.warn({ retry, delayMs }, 'callClaudeJson : 429 reçu — attente avant nouvel essai');
      await sleep(delayMs);
    }
  }
  // Inatteignable (la boucle jette ou retourne toujours) — satisfait le typage.
  throw lastErr;
}

/** Concatène les blocs texte d'une réponse Messages API. */
function textOfResponse(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Appelle Claude et retourne un JSON validé par `schema`.
 * - Mode mock (MOCK_PROVIDERS ou ANTHROPIC_API_KEY absente) : fixture locale,
 *   jamais mise en cache (déjà gratuite et déterministe).
 * - Sinon : vérifie D'ABORD le cache Redis (clé = hash(system+user+model)) avant
 *   tout appel payant — deux tâches de génération demandant le même prompt
 *   (même système, même contenu utilisateur, même modèle) ne paient qu'une fois.
 *   `cost` n'est PAS rejoué sur un hit (aucun token consommé, rien à comptabiliser).
 * - jusqu'à MAX_JSON_ATTEMPTS appels ; chaque échec de validation est
 *   réinjecté dans la conversation pour que le modèle corrige sa sortie.
 * - stop_reason === 'max_tokens' → ClaudeJsonError explicite (troncature).
 */
export async function callClaudeJson<T>(params: CallClaudeJsonParams<T>): Promise<T> {
  const { schema, system, user, model = DEFAULT_CLAUDE_MODEL, skipCache = false, temperature, llmProviderId } = params;
  const config = getConfig();

  if (config.MOCK_PROVIDERS) {
    logger.debug({ model, mock: true }, 'callClaudeJson : mode mock (fixture déterministe)');
    return mockFixtureFor(schema, user);
  }

  const wantsOllama = llmProviderId === 'ollama' || llmProviderId === 'oss';
  const wantsAnthropic = llmProviderId === 'anthropic' || llmProviderId === 'claude';
  const wantsModal = llmProviderId === 'modal';

  // 0) Modal LLM (GPU serverless, vLLM/Qwen2.5) — choix explicite du cours.
  // En cas d'indisponibilité (cold-start trop long, endpoint down), on laisse
  // filer vers la cascade ci-dessous (cloud → Anthropic → Ollama) : jamais de
  // blocage du pipeline.
  if (wantsModal) {
    try {
      const { generateModalLlmJson, isModalLlmConfigured } = await import('../providers/modal-llm-provider.js');
      if (isModalLlmConfigured()) {
        return await generateModalLlmJson({ schema, system, user, temperature });
      }
    } catch (err) {
      logger.warn({ err }, 'callClaudeJson : Modal LLM indisponible/insuffisant — repli cascade');
    }
  }

  // 1) Providers CLOUD OpenAI-compatibles (Gemini gratuit par défaut, DeepSeek,
  // Grok, Qwen…). Choix explicite du cours (llmProviderId) prioritaire, sinon
  // DEFAULT_CLOUD_LLM, sinon le moins cher disponible — voir cloud-llm.ts.
  // Import dynamique : cloud-llm importe extractJsonPayload d'ici (cycle sinon).
  if (!wantsOllama && !wantsAnthropic) {
    try {
      const { resolveCloudLlm, callCloudLlmJson } = await import('../providers/cloud-llm.js');
      const provider = resolveCloudLlm(llmProviderId);
      if (provider) {
        return await callCloudLlmJson({
          provider,
          schema,
          system,
          user,
          temperature,
          maxTokens: params.maxTokens,
          cost: params.cost,
        });
      }
    } catch (err) {
      logger.warn({ err, llmProviderId }, 'callClaudeJson : provider cloud indisponible/insuffisant — repli');
    }
  }

  // 2) Anthropic (SDK) — choix explicite, ou disponible et cloud OpenAI-compat absent.
  if (config.ANTHROPIC_API_KEY && !wantsOllama) {
    if (skipCache) return callClaudeJsonUncached(params);
    const key = claudeCacheKey(system, user, model);
    return getOrCompute<T>(key, CLAUDE_CACHE_TTL_SEC, () => callClaudeJsonUncached(params), 'claude');
  }

  // 3) Ollama LOCAL (P152) — dernier recours réel avant le mock déterministe.
  if (config.OLLAMA_BASE_URL?.trim()) {
    try {
      const { generateOllamaJsonDirect } = await import('../providers/ollama-provider.js');
      return await generateOllamaJsonDirect({ schema, system, user, temperature, critical: true });
    } catch (err) {
      logger.warn({ err }, 'callClaudeJson : Ollama indisponible/insuffisant — repli mock-fixtures');
    }
  }
  logger.debug({ model, mock: true }, 'callClaudeJson : aucun provider disponible — mode mock');
  return mockFixtureFor(schema, user);
}

/** Appel Claude réel, sans passage par le cache (utilisé en interne par callClaudeJson). */
async function callClaudeJsonUncached<T>(params: CallClaudeJsonParams<T>): Promise<T> {
  const { schema, system, user, model = DEFAULT_CLAUDE_MODEL, maxTokens = DEFAULT_MAX_TOKENS, temperature, cost } = params;
  const config = getConfig();
  const client = getClient(config.ANTHROPIC_API_KEY!);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
  let lastRaw = '';
  let lastIssues = '';

  for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
    const response = await createWithRateLimitBackoff(client, {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
    });

    // Coût de CET appel (chaque tentative consomme des tokens, même en retry
    // de validation) — best-effort, ne bloque jamais la génération.
    if (cost) {
      const usage = response.usage;
      const tokensIn = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      await recordClaudeCost(cost, model, tokensIn, usage.output_tokens ?? 0).catch(() => undefined);
    }

    if (response.stop_reason === 'max_tokens') {
      throw new ClaudeJsonError(
        `Réponse tronquée (stop_reason=max_tokens) après ${maxTokens} tokens — augmenter maxTokens ou réduire la demande.`,
        { attempts: attempt },
      );
    }

    lastRaw = textOfResponse(response);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonPayload(lastRaw));
    } catch (err) {
      lastIssues = `JSON invalide : ${(err as Error).message}`;
      logger.warn({ model, attempt, issues: lastIssues }, 'callClaudeJson : parsing JSON échoué');
      messages.push(
        { role: 'assistant', content: lastRaw },
        {
          role: 'user',
          content:
            `Ta réponse n'est pas un JSON parsable (${lastIssues}). ` +
            `Réponds UNIQUEMENT avec le JSON demandé, sans texte autour ni fence Markdown.`,
        },
      );
      continue;
    }

    const validated = schema.safeParse(parsedJson);
    if (validated.success) return validated.data;

    lastIssues = validated.error.issues
      .map((issue) => `- ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    logger.warn({ model, attempt, issues: lastIssues }, 'callClaudeJson : validation Zod échouée');
    messages.push(
      { role: 'assistant', content: lastRaw },
      {
        role: 'user',
        content:
          `Ta réponse JSON ne respecte pas le schéma attendu. Erreurs de validation :\n${lastIssues}\n` +
          `Corrige ces erreurs et réponds UNIQUEMENT avec le JSON complet corrigé.`,
      },
    );
  }

  throw new ClaudeJsonError(
    `Impossible d'obtenir un JSON conforme au schéma après ${MAX_JSON_ATTEMPTS} tentatives.`,
    { attempts: MAX_JSON_ATTEMPTS, lastRaw, issues: lastIssues },
  );
}
