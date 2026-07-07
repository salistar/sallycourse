// Client Anthropic réutilisable : appel JSON structuré + validation Zod,
// retry avec réinjection des erreurs de validation, détection de troncature.
// MOCK_PROVIDERS=true (ou clé absente) court-circuite tout appel payant.
import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { getConfig } from '../shared.js';
import { logger } from '../queues/index.js';
import { mockFixtureFor } from './mock-fixtures.js';

/** Modèle par défaut du pipeline de génération. */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
/** Nombre maximal de tentatives (appel initial + retries de validation). */
export const MAX_JSON_ATTEMPTS = 3;
const DEFAULT_MAX_TOKENS = 8192;

export interface CallClaudeJsonParams<T> {
  /** Schéma Zod attendu — la valeur retournée est garantie conforme. */
  schema: z.ZodType<T>;
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
 */
export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  // Fence Markdown (```json ... ``` ou ``` ... ```)
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  // Déjà du JSON nu
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  // Premier objet/tableau au milieu de prose
  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace >= 0) {
    const open = trimmed[firstBrace];
    const close = open === '{' ? '}' : ']';
    const lastClose = trimmed.lastIndexOf(close);
    if (lastClose > firstBrace) return trimmed.slice(firstBrace, lastClose + 1);
  }
  return trimmed;
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
 * - Mode mock (MOCK_PROVIDERS ou ANTHROPIC_API_KEY absente) : fixture locale.
 * - Sinon : jusqu'à MAX_JSON_ATTEMPTS appels ; chaque échec de validation est
 *   réinjecté dans la conversation pour que le modèle corrige sa sortie.
 * - stop_reason === 'max_tokens' → ClaudeJsonError explicite (troncature).
 */
export async function callClaudeJson<T>(params: CallClaudeJsonParams<T>): Promise<T> {
  const { schema, system, user, model = DEFAULT_CLAUDE_MODEL, maxTokens = DEFAULT_MAX_TOKENS, temperature } = params;
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    logger.debug({ model, mock: true }, 'callClaudeJson : mode mock (fixture déterministe)');
    return mockFixtureFor(schema, user);
  }

  const client = getClient(config.ANTHROPIC_API_KEY);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
  let lastRaw = '';
  let lastIssues = '';

  for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
    });

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
