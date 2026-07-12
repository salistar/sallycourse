import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { getConfig, resolveGenericPromoPeriods } from '@sallycourse/shared';
import { connectDb, Course } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/coupons/promo-calendar — calendrier promotionnel suggéré (P139) :
 * périodes (rentrée, Black Friday…) + pourcentage recommandé selon la
 * catégorie/thématique du cours (déduite du titre, faute de champ catégorie
 * dédié sur Course). Sans ANTHROPIC_API_KEY (ou MOCK_PROVIDERS) : repli
 * déterministe sur les périodes génériques partagées (jamais d'échec bloquant).
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  courseId: z.string().trim(),
});

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const HAIKU_MODEL = 'claude-haiku-4-5';
const CLAUDE_TIMEOUT_MS = 8_000;

const promoPeriodJsonSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  discountPercent: z.number().int().min(1).max(90),
  rationale: z.string().min(1),
});
const promoCalendarJsonSchema = z.object({ periods: z.array(promoPeriodJsonSchema).min(2).max(6) });

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
async function suggestWithClaude(
  apiKey: string,
  courseTitle: string,
  difficulty: string,
  year: number,
): Promise<z.infer<typeof promoCalendarJsonSchema> | null> {
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
      max_tokens: 1024,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              periods: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    startDate: { type: 'string' },
                    endDate: { type: 'string' },
                    discountPercent: { type: 'number' },
                    rationale: { type: 'string' },
                  },
                  required: ['name', 'startDate', 'endDate', 'discountPercent', 'rationale'],
                  additionalProperties: false,
                },
              },
            },
            required: ['periods'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content:
            `Propose un calendrier de 3 à 5 périodes promotionnelles (ex. rentrée, Black Friday, nouvel an, ` +
            `saison propre à la thématique) pour le cours « ${courseTitle} » (niveau ${difficulty}), année ${year}. ` +
            `Pour chaque période : nom, dates YYYY-MM-DD, pourcentage de remise recommandé (1-90) cohérent ` +
            `avec l'intensité concurrentielle habituelle, et une justification courte.`,
        },
      ],
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = payload.content?.find((block) => block.type === 'text')?.text;
  if (!text) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = promoCalendarJsonSchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isValidObjectId(parsed.data.courseId)) {
    return NextResponse.json({ error: 'courseId invalide.' }, { status: 400 });
  }

  await connectDb();
  const course = await Course.findOne({ _id: parsed.data.courseId, userId: user.id })
    .select('title difficulty')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const year = new Date().getFullYear();
  const localPeriods = resolveGenericPromoPeriods(year);
  const { apiKey, mock } = resolveProvider();

  if (mock || !apiKey) {
    return NextResponse.json({ periods: localPeriods, source: 'local' });
  }

  try {
    const suggestion = await suggestWithClaude(apiKey, course.title, course.difficulty, year);
    if (suggestion) {
      return NextResponse.json({ periods: suggestion.periods, source: 'claude' });
    }
  } catch {
    // Timeout / réseau : on retombe sur le calendrier générique sans bruit.
  }

  return NextResponse.json({ periods: localPeriods, source: 'local' });
}
