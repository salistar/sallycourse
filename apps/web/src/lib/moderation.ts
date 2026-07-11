import { z } from 'zod';
import { getConfig } from '@sallycourse/shared';
import { logger } from './logger';

/**
 * Modération de contenu (P70) — vérifie qu'un titre de cours n'est pas un
 * contenu interdit (médical dangereux, haineux, contrefaçon de marque
 * flagrante) avant de lancer la génération. Appel Claude direct via fetch
 * (pas de dépendance @anthropic-ai/sdk côté web — non installée ici) : la
 * même API Messages que le worker (lib/claude.ts), mais surface minimale.
 *
 * MOCK-friendly : MOCK_PROVIDERS=true (ou clé absente) → fixture locale
 * toujours { allowed: true }, sauf mots-clés triviaux de test permettant de
 * vérifier le chemin de refus sans appel réseau.
 */

export const moderationResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  category: z.string().optional(),
});

export type ModerationResult = z.infer<typeof moderationResultSchema>;

/** Mots-clés déclenchant un refus déterministe en mode mock (tests uniquement). */
const MOCK_BLOCKED_KEYWORDS: readonly { needle: string; category: string; reason: string }[] = [
  {
    needle: 'piraté',
    category: 'contrefaçon',
    reason: 'Le titre fait référence à un contenu piraté / contrefaçon de marque.',
  },
  {
    needle: 'cracké',
    category: 'contrefaçon',
    reason: 'Le titre fait référence à un logiciel cracké.',
  },
  {
    needle: 'guérir le cancer',
    category: 'médical dangereux',
    reason: 'Promesse médicale dangereuse et non fondée.',
  },
];

function mockModeration(title: string): ModerationResult {
  const lower = title.toLowerCase();
  for (const entry of MOCK_BLOCKED_KEYWORDS) {
    if (lower.includes(entry.needle)) {
      return { allowed: false, reason: entry.reason, category: entry.category };
    }
  }
  return { allowed: true };
}

const MODERATION_SYSTEM_PROMPT = `Tu es un modérateur de contenu pour une plateforme de génération de cours en ligne.
On te donne UNIQUEMENT le titre d'un cours proposé par un utilisateur. Détermine s'il doit être
bloqué pour l'une de ces raisons :
- contenu médical dangereux (fausses promesses de guérison, conseils médicaux risqués sans encadrement) ;
- contenu haineux, discriminatoire ou incitant à la violence ;
- contrefaçon de marque flagrante (ex: cours vendant un logiciel piraté/cracké/contrefait).

Un titre mentionnant un logiciel commercial de façon légitime (ex: "Apprendre Photoshop", "Maîtriser Excel")
est AUTORISÉ — seule la contrefaçon flagrante (piratage, crack, contournement de licence) doit être bloquée.
En cas de doute raisonnable, AUTORISE (allowed=true) : le système ne doit pas censurer excessivement.

Réponds UNIQUEMENT avec un JSON de la forme :
{"allowed": boolean, "reason": string (optionnel, expliquant le refus), "category": string (optionnel)}`;

interface AnthropicMessageResponse {
  content: { type: string; text?: string }[];
}

/** Extrait le premier bloc JSON d'une réponse texte (fences ``` ou JSON nu). */
function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  if (trimmed.startsWith('{')) return trimmed;
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

/**
 * Vérifie qu'un titre de cours est autorisé. En cas d'échec technique (réseau,
 * clé invalide, JSON malformé), retourne allowed=true par défaut : la
 * modération ne doit jamais bloquer la création à cause d'une panne — le
 * risque de contenu interdit non filtré est jugé préférable à un blocage
 * intempestif de tous les utilisateurs.
 */
export async function moderateCourseTitle(title: string): Promise<ModerationResult> {
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    return mockModeration(title);
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
        model: 'claude-sonnet-5',
        max_tokens: 512,
        system: MODERATION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Titre du cours : "${title}"` }],
      }),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'moderateCourseTitle : appel Claude en échec, autorisation par défaut');
      return { allowed: true };
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    const text = data.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('\n');

    const parsed = moderationResultSchema.safeParse(JSON.parse(extractJsonPayload(text)));
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'moderateCourseTitle : JSON de modération invalide, autorisation par défaut');
      return { allowed: true };
    }
    return parsed.data;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'moderateCourseTitle : erreur technique, autorisation par défaut');
    return { allowed: true };
  }
}
