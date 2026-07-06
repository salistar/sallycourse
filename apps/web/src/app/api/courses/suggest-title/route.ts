import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UDEMY, getConfig } from '@sallycourse/shared';
import { buildTitleSuggestions } from '@/components/create/mock-title-suggestions';

/**
 * POST /api/courses/suggest-title — suggestions de titres pour le formulaire
 * de création. Sans ANTHROPIC_API_KEY (ou avec MOCK_PROVIDERS=true), on sert
 * le moteur local existant ; sinon on demande 5 titres à Claude Haiku en
 * sortie JSON structurée. Toute défaillance retombe silencieusement sur le mock.
 */

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
});

/** Forme attendue de la réponse structurée de Claude. */
const claudeSuggestionsSchema = z.object({
  suggestions: z.array(z.string().min(1)).min(1),
});

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const HAIKU_MODEL = 'claude-haiku-4-5';
const CLAUDE_TIMEOUT_MS = 8_000;
const SUGGESTIONS_COUNT = 5;

/** Lit la config sans jeter : une config incomplète équivaut au mode mock. */
function resolveProvider(): { apiKey?: string; mock: boolean } {
  try {
    const config = getConfig();
    return { apiKey: config.ANTHROPIC_API_KEY, mock: config.MOCK_PROVIDERS };
  } catch {
    return { apiKey: undefined, mock: true };
  }
}

/** Appelle Claude Haiku (fetch natif, sortie JSON contrainte par schéma). */
async function suggestWithClaude(apiKey: string, subject: string): Promise<string[] | null> {
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 512,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              suggestions: { type: 'array', items: { type: 'string' } },
            },
            required: ['suggestions'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content:
            `Propose exactement ${SUGGESTIONS_COUNT} titres accrocheurs pour un cours en ligne ` +
            `sur le sujet suivant : « ${subject} ». Contraintes : même langue que le sujet, ` +
            `${UDEMY.TITLE_MAX_CHARS} caractères maximum par titre, orientés bénéfice concret ` +
            `pour l'apprenant, sans numérotation ni guillemets.`,
        },
      ],
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = payload.content?.find((block) => block.type === 'text')?.text;
  if (!text) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = claudeSuggestionsSchema.safeParse(parsedJson);
  if (!parsed.success) return null;

  // Bornes du schéma partagé (titre <= 120 caractères), 5 max.
  return parsed.data.suggestions
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 120)
    .slice(0, SUGGESTIONS_COUNT);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  }

  const subject = parsed.data.title;
  const localSuggestions = buildTitleSuggestions(subject);
  const { apiKey, mock } = resolveProvider();

  if (mock || !apiKey) {
    return NextResponse.json({ suggestions: localSuggestions, source: 'local' });
  }

  try {
    const suggestions = await suggestWithClaude(apiKey, subject);
    if (suggestions && suggestions.length > 0) {
      return NextResponse.json({ suggestions, source: 'claude' });
    }
  } catch {
    // Timeout / réseau : on retombe sur le mock sans bruit.
  }

  return NextResponse.json({ suggestions: localSuggestions, source: 'local' });
}
