// Calendrier promotionnel suggéré (Prompt 139) : callClaudeJson propose des
// périodes de promotion (ex. rentrée, Black Friday) avec un pourcentage de
// remise recommandé, adapté à la catégorie du cours. Mode mock/dégradé (LLM
// indisponible) : repli déterministe sur GENERIC_PROMO_PERIODS (shared/coupon.ts),
// jamais d'échec bloquant — un calendrier générique reste toujours utile.
import { z } from 'zod';
import {
  getConfig,
  resolveGenericPromoPeriods,
  type Difficulty,
} from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import { logger } from '../queues/index.js';

/** Schéma d'une suggestion de période promotionnelle (aligné sur PromoPeriodSuggestion). */
export const promoPeriodSchema = z.object({
  name: z.string().min(1).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format attendu YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format attendu YYYY-MM-DD'),
  discountPercent: z.number().int().min(1).max(90),
  rationale: z.string().min(1).max(400),
});

export const promoCalendarSchema = z.object({
  periods: z.array(promoPeriodSchema).min(2).max(6),
});

export type PromoCalendar = z.infer<typeof promoCalendarSchema>;

/** Prompt système : rôle stratège pricing + contrat de sortie JSON strict. */
function promoCalendarSystemPrompt(): string {
  return [
    `Tu es un stratège pricing spécialisé en cours en ligne (Udemy et LMS internes).`,
    `Tu proposes un calendrier de périodes promotionnelles pour UN cours, adapté à sa catégorie/thématique.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Propose entre 3 et 5 périodes réparties sur l'année (ex. rentrée, Black Friday, nouvel an, saison propre à la thématique).`,
    `2. Chaque période a un "discountPercent" recommandé (1-90) cohérent avec l'intensité concurrentielle habituelle de la période (Black Friday = remise plus forte).`,
    `3. Dates au format YYYY-MM-DD, cohérentes (endDate après startDate), sur une durée de quelques jours à 2 semaines.`,
    `4. "rationale" : une phrase courte justifiant le choix (pourquoi cette période convertit bien pour ce type de cours).`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{ "periods": [ { "name": string, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "discountPercent": number, "rationale": string } ] }`,
  ].join('\n');
}

/** Prompt utilisateur : contexte du cours (titre balisé « … » pour extraction mock). */
function promoCalendarUserPrompt(input: { courseTitle: string; difficulty: Difficulty; year: number }): string {
  return [
    `Construis un calendrier promotionnel pour le cours « ${input.courseTitle} » (niveau ${input.difficulty}).`,
    `Année de référence pour les dates : ${input.year}.`,
  ].join('\n');
}

/**
 * Suggère un calendrier promotionnel pour un cours. Mode mock/dégradé (pas de
 * clé Anthropic ou MOCK_PROVIDERS=true) : repli déterministe sur les 3
 * périodes génériques (rentrée, Black Friday, nouvel an) — jamais d'appel LLM
 * en mock, cohérent avec le reste du worker (ex. udemy.ts:resolveCategory).
 */
export async function suggestPromoCalendar(params: {
  courseTitle: string;
  difficulty: Difficulty;
  year?: number;
  cost?: { courseId: string; userId: string };
}): Promise<PromoCalendar> {
  const year = params.year ?? new Date().getFullYear();
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    return { periods: resolveGenericPromoPeriods(year) };
  }

  try {
    return await callClaudeJson<PromoCalendar>({
      schema: promoCalendarSchema,
      system: promoCalendarSystemPrompt(),
      user: promoCalendarUserPrompt({ courseTitle: params.courseTitle, difficulty: params.difficulty, year }),
      cost: params.cost,
    });
  } catch (err) {
    // Best-effort : un calendrier générique reste toujours préférable à une erreur bloquante.
    logger.warn({ err: (err as Error).message }, 'calendrier promo LLM échoué — repli générique');
    return { periods: resolveGenericPromoPeriods(year) };
  }
}
