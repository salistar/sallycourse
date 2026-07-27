import { getConfig } from '@sallycourse/shared/config';
import {
  learningPathSalesPageSchema,
  type LearningPathSalesPage,
} from '@sallycourse/shared/learning-path';
import { logger } from './logger';

/**
 * Page de vente d'un parcours d'apprentissage (Prompt 199) — génération à la
 * demande depuis le dashboard. Appel Claude direct via fetch, même patron que
 * exercise-generator.ts (aucune nouvelle queue BullMQ : la sortie est courte et
 * l'auteur attend le résultat). MOCK-friendly : MOCK_PROVIDERS=true (ou clé
 * Anthropic absente) → fixture déterministe, sans réseau.
 */

export interface PathSalesPageInput {
  pathTitle: string;
  pathDescription: string;
  locale: 'fr' | 'en' | 'ar';
  /** Cours du parcours, DANS L'ORDRE (identité + titre + résumé du LmsListing). */
  courses: { courseId: string; title: string; summary: string }[];
  /** Prix du bundle et somme des prix des cours pris séparément (centimes). */
  bundlePriceCents: number;
  coursesTotalCents: number;
  currency: string;
}

const LOCALE_LABELS: Record<PathSalesPageInput['locale'], string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict (learningPathSalesPageSchema). */
export function salesPageSystemPrompt(): string {
  return [
    `Tu es un copywriter spécialisé dans la vente de formations en ligne.`,
    `On te donne un PARCOURS : une suite ordonnée de cours qui mène l'apprenant d'un point A à un point B.`,
    `Tu rédiges la page de vente du parcours COMPLET (pas d'un cours isolé).`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Vends la PROGRESSION : l'intérêt du parcours est l'enchaînement des cours, pas leur simple addition.`,
    `2. "outcomes" : 3 à 8 bénéfices CONCRETS et vérifiables une fois le parcours terminé.`,
    `3. "audience" : 2 à 6 profils précis (pas « tout le monde »).`,
    `4. "courseTeasers" : un objet par cours, DANS L'ORDRE FOURNI, reprenant exactement le titre donné,`,
    `   avec un pitch expliquant ce que cette étape apporte et pourquoi elle vient à ce moment du parcours.`,
    `5. "faq" : 2 à 6 questions/réponses honnêtes (durée, prérequis, certificat, prix).`,
    `6. Aucune promesse mensongère (revenus garantis, emploi garanti) : ton crédible et factuel.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{`,
    `  "headline": string,`,
    `  "subheadline": string,`,
    `  "outcomes": string[],`,
    `  "audience": string[],`,
    `  "courseTeasers": [{ "courseTitle": string, "pitch": string }],`,
    `  "faq": [{ "question": string, "answer": string }],`,
    `  "ctaLabel": string`,
    `}`,
  ].join('\n');
}

/** Prompt utilisateur : parcours, cours ordonnés et argument prix. */
export function salesPageUserPrompt(input: PathSalesPageInput): string {
  const priceLine =
    input.bundlePriceCents > 0
      ? `Prix du parcours : ${(input.bundlePriceCents / 100).toFixed(2)} ${input.currency}, contre ${(input.coursesTotalCents / 100).toFixed(2)} ${input.currency} en achetant les cours séparément.`
      : `Le parcours est GRATUIT : ne parle pas de prix, insiste sur l'accès immédiat.`;

  return [
    `Parcours : « ${input.pathTitle} ».`,
    input.pathDescription ? `Description fournie par l'auteur : ${input.pathDescription}` : '',
    `Langue : rédige TOUS les textes en ${LOCALE_LABELS[input.locale]}.`,
    priceLine,
    ``,
    `Cours du parcours, dans l'ordre :`,
    ...input.courses.map(
      (course, index) =>
        `${index + 1}. « ${course.title} »${course.summary ? ` — ${course.summary}` : ''}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

interface AnthropicMessageResponse {
  content: { type: string; text?: string }[];
}

/** Extrait le premier bloc JSON (objet) d'une réponse texte. */
function extractJsonObjectPayload(raw: string): string {
  const trimmed = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) return fence[1].trim();
  if (trimmed.startsWith('{')) return trimmed;
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

/** Fixture déterministe (mode mock) — dérivée du parcours réel, sans appel réseau. */
function mockSalesPage(input: PathSalesPageInput): LearningPathSalesPage {
  const first = input.courses[0]?.title ?? 'le premier cours';
  const last = input.courses[input.courses.length - 1]?.title ?? 'le dernier cours';

  return {
    headline: `[mock] ${input.pathTitle} — de « ${first} » à « ${last} »`,
    subheadline: `Un parcours de ${input.courses.length} cours, à suivre dans l'ordre, jusqu'au certificat de parcours.`,
    outcomes: [
      `Maîtriser les bases posées par « ${first} »`,
      `Enchaîner les ${input.courses.length} cours sans trou dans la progression`,
      `Obtenir le certificat de parcours à la fin de « ${last} »`,
    ],
    audience: [
      'Débutants qui veulent une progression balisée plutôt qu’une liste de cours',
      'Apprenants déjà initiés qui veulent combler leurs lacunes dans l’ordre',
    ],
    courseTeasers: input.courses.map((course, index) => ({
      courseId: course.courseId,
      courseTitle: course.title,
      pitch: `[Réponse simulée — MOCK_PROVIDERS actif ou clé Anthropic absente] Étape ${index + 1} du parcours : ${course.summary || course.title}.`,
    })),
    faq: [
      {
        question: 'Dois-je suivre les cours dans l’ordre ?',
        answer:
          'Oui lorsque l’auteur a activé les prérequis : un cours reste verrouillé tant que le précédent n’est pas terminé.',
      },
      {
        question: 'Que se passe-t-il si je suis déjà inscrit à un des cours ?',
        answer:
          'Votre inscription et votre progression existantes sont conservées : le parcours les réutilise telles quelles.',
      },
    ],
    ctaLabel: input.bundlePriceCents > 0 ? 'Rejoindre le parcours' : 'Commencer gratuitement',
  };
}

/**
 * Génère la page de vente du parcours via Claude (ou fixture mock). En cas
 * d'échec technique (réseau, JSON non conforme au schéma), jette — la route
 * API retourne alors 502 plutôt que de persister une page de vente dégradée.
 */
export async function generatePathSalesPage(
  input: PathSalesPageInput,
): Promise<LearningPathSalesPage> {
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    return mockSalesPage(input);
  }

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
      max_tokens: 4096,
      system: salesPageSystemPrompt(),
      messages: [{ role: 'user', content: salesPageUserPrompt(input) }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'generatePathSalesPage : appel Claude en échec');
    throw new Error(`Échec de l'appel Claude (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const text = data.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');

  const parsed = learningPathSalesPageSchema.safeParse(JSON.parse(extractJsonObjectPayload(text)));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'generatePathSalesPage : JSON invalide');
    throw new Error('Page de vente générée non conforme au format attendu.');
  }
  return attachTeaserCourseIds(parsed.data, input.courses);
}

/**
 * Rattache à chaque teaser le `courseId` du cours correspondant. Le LLM produit
 * les teasers DANS L'ORDRE des cours fournis (contrat du prompt) : on apparie
 * donc par position. Les teasers surnuméraires (le LLM en a produit plus que de
 * cours) restent sans identité et retomberont sur le résumé du cours à
 * l'affichage. PURE.
 */
export function attachTeaserCourseIds(
  page: LearningPathSalesPage,
  courses: readonly { courseId: string }[],
): LearningPathSalesPage {
  return {
    ...page,
    courseTeasers: page.courseTeasers.map((teaser, index) => ({
      ...teaser,
      courseId: courses[index]?.courseId ?? teaser.courseId,
    })),
  };
}
