import { getConfig } from '@sallycourse/shared';
import { logger } from './logger';

/**
 * Bouton « Tester » du playground de prompts admin (P93) — appelle Claude
 * avec un couple (system, user) fourni par l'admin et retourne le texte brut
 * de la réponse (pas de schéma Zod imposé : l'admin teste un prompt encore en
 * rédaction, potentiellement non-JSON). Même pattern que moderateCourseTitle
 * (apps/web/src/lib/moderation.ts) : fetch natif, pas de @anthropic-ai/sdk
 * côté web. MOCK-friendly : MOCK_PROVIDERS=true (ou clé absente) → réponse
 * simulée déterministe, jamais d'appel réseau réel en test.
 */

export interface PromptTestResult {
  ok: boolean;
  /** Texte brut renvoyé par le modèle (ou message d'erreur si ok=false). */
  output: string;
  mock: boolean;
}

const TEST_MODEL = 'claude-sonnet-5';
const TEST_MAX_TOKENS = 1024;

interface AnthropicMessageResponse {
  content: { type: string; text?: string }[];
}

function mockResponse(system: string, user: string): string {
  return [
    '[Réponse simulée — MOCK_PROVIDERS actif ou clé Anthropic absente]',
    `Système reçu (${system.length} caractères) : "${system.slice(0, 80)}${system.length > 80 ? '…' : ''}"`,
    `Message utilisateur reçu (${user.length} caractères) : "${user.slice(0, 80)}${user.length > 80 ? '…' : ''}"`,
    'Aucun appel réseau réel effectué en mode mock.',
  ].join('\n');
}

/** Exécute un couple (system, user) contre Claude et retourne le texte brut. */
export async function testPrompt(system: string, user: string): Promise<PromptTestResult> {
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    return { ok: true, output: mockResponse(system, user), mock: true };
  }

  try {
    const baseURL = process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
    const response = await fetch(`${baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: TEST_MODEL,
        max_tokens: TEST_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'testPrompt : appel Claude en échec');
      return { ok: false, output: `Échec de l'appel Claude (HTTP ${response.status}).`, mock: false };
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    const text = data.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n');

    return { ok: true, output: text || '(réponse vide)', mock: false };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'testPrompt : erreur technique');
    return { ok: false, output: `Erreur technique : ${(err as Error).message}`, mock: false };
  }
}
