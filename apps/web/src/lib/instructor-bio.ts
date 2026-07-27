import { getConfig } from '@sallycourse/shared/config';
import { instructorBioSchema, type InstructorBio } from '@sallycourse/shared/instructor';
import { logger } from './logger';

/**
 * Bio d'instructeur pour la page publique (Prompt 205) — générée à la demande
 * depuis les réglages. Appel Claude direct via fetch, même patron que
 * path-sales-page.ts / exercise-generator.ts (sortie courte, l'auteur attend le
 * résultat : aucune queue BullMQ). MOCK-friendly : MOCK_PROVIDERS=true (ou clé
 * Anthropic absente) → fixture déterministe, sans réseau.
 *
 * La bio est dérivée UNIQUEMENT du catalogue PUBLIÉ (titres + résumés + volumes
 * + plateformes de déploiement réelles) : aucune donnée privée (email, revenus,
 * brouillons) n'entre dans le prompt.
 */

export interface InstructorBioCourseInput {
  title: string;
  summary: string;
  lessonCount: number;
  durationMin: number;
}

export interface InstructorBioInput {
  name: string;
  locale: 'fr' | 'en' | 'ar';
  /** Cours PUBLIÉS de l'instructeur (jamais les brouillons). */
  courses: InstructorBioCourseInput[];
  /** Plateformes distinctes où au moins un cours est publié (udemy, youtube…). */
  platforms: string[];
  /** Apprenants inscrits sur le LMS interne (agrégat public). */
  studentCount: number;
}

const LOCALE_LABELS: Record<InstructorBioInput['locale'], string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict (instructorBioSchema). */
export function instructorBioSystemPrompt(): string {
  return [
    `Tu rédiges la biographie publique d'un formateur en ligne, pour sa page portfolio.`,
    `On te donne UNIQUEMENT son nom et son catalogue de cours PUBLIÉS.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Rédige à la 3e personne, ton factuel et sobre.`,
    `2. N'INVENTE RIEN : aucun diplôme, employeur, ancienneté, récompense ou chiffre qui ne`,
    `   soit pas déductible du catalogue fourni. En cas de doute, reste général.`,
    `3. "headline" : une accroche d'une ligne (max 120 caractères) résumant le domaine enseigné.`,
    `4. "bio" : 2 à 3 paragraphes courts (60 à 1200 caractères au total) sur ce qu'il enseigne,`,
    `   la façon dont ses cours sont construits et à qui ils s'adressent.`,
    `5. "expertise" : 2 à 8 domaines d'expertise DÉDUITS des titres et résumés des cours.`,
    `6. Aucune promesse mensongère (revenus garantis, emploi garanti).`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{ "headline": string, "bio": string, "expertise": string[] }`,
  ].join('\n');
}

/** Prompt utilisateur : le catalogue public, rien d'autre. */
export function instructorBioUserPrompt(input: InstructorBioInput): string {
  const lines = [
    `Formateur : ${input.name}.`,
    `Langue : rédige TOUS les textes en ${LOCALE_LABELS[input.locale]}.`,
    `Cours publiés (${input.courses.length}) :`,
    ...input.courses.map(
      (course) =>
        `- « ${course.title} » (${course.lessonCount} leçons, ${course.durationMin} min)${
          course.summary ? ` — ${course.summary}` : ''
        }`,
    ),
  ];
  if (input.platforms.length > 0) {
    lines.push(`Plateformes de diffusion : ${input.platforms.join(', ')}.`);
  }
  if (input.studentCount > 0) {
    lines.push(`Apprenants inscrits sur la plateforme : ${input.studentCount}.`);
  }
  return lines.join('\n');
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

/**
 * Domaines d'expertise de repli : les mots significatifs des titres de cours
 * (déterministe, sans LLM). Sert de fixture mock et garantit les 2 entrées
 * minimales exigées par instructorBioSchema même avec un seul cours.
 */
export function expertiseFromCourses(
  courses: readonly InstructorBioCourseInput[],
  fallback: readonly string[] = ['Formation en ligne', 'Pédagogie'],
): string[] {
  const titles = courses.map((course) => course.title.trim()).filter(Boolean).slice(0, 8);
  const expertise = [...new Set(titles)];
  for (const item of fallback) {
    if (expertise.length >= 2) break;
    if (!expertise.includes(item)) expertise.push(item);
  }
  return expertise.slice(0, 8);
}

/** Fixture déterministe (mode mock) — dérivée du catalogue réel, sans appel réseau. */
export function mockInstructorBio(input: InstructorBioInput): InstructorBio {
  const totalLessons = input.courses.reduce((sum, course) => sum + course.lessonCount, 0);
  const domain = input.courses[0]?.title ?? 'la formation en ligne';

  const paragraphs = [
    `[Réponse simulée — MOCK_PROVIDERS actif ou clé Anthropic absente] ${input.name} publie ${input.courses.length} cours en ligne, soit ${totalLessons} leçons au total.`,
    `Ses cours, dont « ${domain} », sont structurés en sections progressives mêlant vidéos, articles et quiz.`,
    input.platforms.length > 0
      ? `Ses contenus sont diffusés sur : ${input.platforms.join(', ')}.`
      : `Ses contenus sont diffusés sur la plateforme SallyCourse.`,
  ];

  return {
    headline: `Formateur — ${domain}`.slice(0, 120),
    bio: paragraphs.join('\n\n'),
    expertise: expertiseFromCourses(input.courses),
  };
}

/**
 * Génère la bio publique via Claude (ou fixture mock). En cas d'échec technique
 * (réseau, JSON non conforme au schéma), jette — la route API retourne alors
 * 502 plutôt que de persister une bio dégradée.
 */
export async function generateInstructorBio(input: InstructorBioInput): Promise<InstructorBio> {
  const config = getConfig();

  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    return mockInstructorBio(input);
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
      max_tokens: 2048,
      system: instructorBioSystemPrompt(),
      messages: [{ role: 'user', content: instructorBioUserPrompt(input) }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    logger.warn({ status: response.status }, 'generateInstructorBio : appel Claude en échec');
    throw new Error(`Échec de l'appel Claude (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const text = data.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');

  const parsed = instructorBioSchema.safeParse(JSON.parse(extractJsonObjectPayload(text)));
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'generateInstructorBio : JSON invalide');
    throw new Error('Bio générée non conforme au format attendu.');
  }
  return parsed.data;
}
