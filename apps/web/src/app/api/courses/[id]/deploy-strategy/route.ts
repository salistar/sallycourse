import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { getConfig } from '@sallycourse/shared';
import { Course as CourseModel, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import {
  buildUtmParams,
  deploymentStrategySchema,
  mockDeploymentStrategy,
  type DeploymentStrategy,
} from '@/lib/cross-platform-strategy';

/**
 * POST /api/courses/[id]/deploy-strategy (Prompt 110) — recommande une
 * stratégie de déploiement cross-platform (plateformes + mode + calendrier)
 * à partir du sujet/niveau/langue du cours, pour pré-remplir l'écran de
 * déploiement (bouton « Suggérer une stratégie »). Sans ANTHROPIC_API_KEY (ou
 * MOCK_PROVIDERS=true), sert l'heuristique locale déterministe ; sinon
 * interroge Claude en sortie JSON structurée (fetch REST direct, même pattern
 * que /api/courses/suggest-title — le web n'importe jamais le SDK worker).
 * Ajoute aussi les paramètres UTM unifiés par plateforme recommandée.
 */

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODEL = 'claude-sonnet-5';
const CLAUDE_TIMEOUT_MS = 15_000;

/** Lit la config sans jeter : une config incomplète équivaut au mode mock. */
function resolveProvider(): { apiKey?: string; mock: boolean } {
  try {
    const config = getConfig();
    return { apiKey: config.ANTHROPIC_API_KEY, mock: config.MOCK_PROVIDERS };
  } catch {
    return { apiKey: undefined, mock: true };
  }
}

const STRATEGY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    recommendedPlatforms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          mode: { type: 'string', enum: ['auto', 'assisted', 'manual'] },
          rationale: { type: 'string' },
          timing: { type: 'integer', minimum: 0 },
        },
        required: ['platform', 'mode', 'rationale', 'timing'],
        additionalProperties: false,
      },
    },
    calendarPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          action: { type: 'string' },
          dayOffset: { type: 'integer', minimum: 0 },
        },
        required: ['platform', 'action', 'dayOffset'],
        additionalProperties: false,
      },
    },
  },
  required: ['recommendedPlatforms', 'calendarPlan'],
  additionalProperties: false,
} as const;

/** Appelle Claude (fetch natif, sortie JSON contrainte par schéma). */
async function recommendWithClaude(
  apiKey: string,
  input: { title: string; difficulty: string; locale: string; description: string },
): Promise<DeploymentStrategy | null> {
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      output_config: { format: { type: 'json_schema', schema: STRATEGY_JSON_SCHEMA } },
      messages: [
        {
          role: 'user',
          content:
            'Tu es un expert en distribution de formations en ligne (marketing multi-plateformes). ' +
            "À partir du sujet, du niveau et de la langue d'un cours, recommande une stratégie de " +
            'déploiement cross-platform réaliste (ex. Udemy payant + YouTube en funnel gratuit + ' +
            'posts LinkedIn + clips courts programmés). timing/dayOffset = décalage en JOURS depuis ' +
            'le lancement (0 = jour J, entiers ≥ 0). Langue de la rationale/action : français. ' +
            `Cours : ${JSON.stringify(input)}`,
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

  const parsed = deploymentStrategySchema.safeParse(parsedJson);
  return parsed.success ? parsed.data : null;
}

/** Enrichit la recommandation avec les paramètres UTM unifiés par plateforme. */
function withUtm(courseId: string, title: string, strategy: DeploymentStrategy) {
  return {
    ...strategy,
    recommendedPlatforms: strategy.recommendedPlatforms.map((p) => ({
      ...p,
      utm: buildUtmParams(courseId, title, p.platform),
    })),
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('_id title difficulty locale outline')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const description = (course.outline as { description?: string } | null | undefined)?.description ?? '';
  const { apiKey, mock } = resolveProvider();

  if (!mock && apiKey) {
    try {
      const strategy = await recommendWithClaude(apiKey, {
        title: course.title,
        difficulty: course.difficulty,
        locale: course.locale,
        description,
      });
      if (strategy) {
        return NextResponse.json({ courseId: id, source: 'claude', ...withUtm(id, course.title, strategy) });
      }
    } catch {
      // Timeout / réseau : on retombe sur l'heuristique locale sans bruit.
    }
  }

  const strategy = mockDeploymentStrategy(course.title, description);
  return NextResponse.json({ courseId: id, source: 'local', ...withUtm(id, course.title, strategy) });
}
