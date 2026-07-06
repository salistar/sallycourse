// Prompts de la landing marketing du cours — sortie alignée sur marketingSchema
// (description Udemy SEO, messages accueil/félicitations, promo, idées de titres).
import { MARKETING_TITLE_IDEAS, UDEMY, type Difficulty, type Locale } from '../shared.js';

export interface MarketingPromptInput {
  courseTitle: string;
  /** Sous-titre issu de l'outline (contexte de positionnement). */
  subtitle?: string;
  /** Description brute de l'outline (matière première à réécrire, pas à copier). */
  description?: string;
  /** Objectifs pédagogiques de l'outline (arguments de vente concrets). */
  learningObjectives?: readonly string[];
  difficulty: Difficulty;
  locale: Locale;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant (rassurer : aucun prérequis, progression douce)',
  intermediate: 'intermédiaire (promettre de la pratique et des cas réels)',
  advanced: 'avancé (mettre en avant la profondeur technique et les arbitrages experts)',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : rôle de copywriter + contrat de sortie JSON strict. */
export function marketingSystemPrompt(): string {
  return [
    `Tu es un copywriter spécialisé dans les pages de vente de cours en ligne (Udemy).`,
    `Tu produis l'intégralité des textes marketing d'UN cours : description SEO, messages automatiques et idées de titres.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. "udemyDescription" : AU MOINS ${UDEMY.DESCRIPTION_MIN_WORDS} mots, optimisée SEO (mots-clés du sujet répétés naturellement), structurée : accroche bénéfice, ce que l'élève saura faire, programme résumé, public visé, appel à l'action final. Paragraphes courts, pas de murs de texte.`,
    `2. Vends des RÉSULTATS concrets, jamais de superlatifs creux (« le meilleur cours ») ni de fausses promesses.`,
    `3. "welcomeMessage" : 2-4 phrases chaleureuses envoyées à l'inscription — souhaite la bienvenue, donne le premier pas concret et encourage.`,
    `4. "congratsMessage" : 2-4 phrases envoyées à la fin du cours — félicite, rappelle le chemin parcouru, propose la suite (pratique, avis, autre cours).`,
    `5. "promoText" : 1-3 phrases percutantes réutilisables telles quelles sur les réseaux sociaux ou dans une annonce.`,
    `6. "titleIdeas" : exactement ${MARKETING_TITLE_IDEAS} titres alternatifs, chacun de ${UDEMY.TITLE_MAX_CHARS} caractères MAXIMUM, tous distincts, avec un "score" (0-100, potentiel commercial estimé) et une "reason" courte justifiant le score (mot-clé fort, promesse claire, curiosité…).`,
    `7. Aucune mention de prix, de réduction chiffrée ou de plateforme concurrente.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{`,
    `  "udemyDescription": string,`,
    `  "welcomeMessage": string,`,
    `  "congratsMessage": string,`,
    `  "promoText": string,`,
    `  "titleIdeas": [ { "title": string, "score": number, "reason": string } ] (exactement ${MARKETING_TITLE_IDEAS} éléments)`,
    `}`,
  ].join('\n');
}

/** Prompt utilisateur : contexte du cours (titre balisé « … » pour extraction mock). */
export function marketingUserPrompt(input: MarketingPromptInput): string {
  const { courseTitle, subtitle, description, learningObjectives, difficulty, locale } = input;
  const lines = [
    `Écris les textes marketing du cours « ${courseTitle} ».`,
    `Niveau : ${DIFFICULTY_LABELS[difficulty]}.`,
  ];
  if (subtitle) lines.push(`Sous-titre actuel : ${subtitle}`);
  if (description) lines.push(`Description de travail (à réécrire en version vendeuse, ne pas copier) : ${description}`);
  if (learningObjectives && learningObjectives.length > 0) {
    lines.push(`Objectifs pédagogiques :\n${learningObjectives.map((o) => `- ${o}`).join('\n')}`);
  }
  lines.push(`Tous les textes intégralement rédigés en ${LOCALE_LABELS[locale]}.`);
  return lines.join('\n');
}
