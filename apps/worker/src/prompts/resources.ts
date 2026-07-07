// Prompts du générateur de ressources téléchargeables (Prompt 65) — sortie
// JSON conforme à courseResourcesContentSchema : glossaire des termes clés du
// cours + liste de ressources « pour aller plus loin ».
import type { Difficulty, Locale } from '../shared.js';

export interface ResourcesPromptInput {
  courseTitle: string;
  subtitle?: string;
  difficulty: Difficulty;
  locale: Locale;
  /** Titres des sections + leçons du plan (vue d'ensemble du contenu couvert). */
  outlineSummary: string;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant (définitions simples, aucun jargon non expliqué)',
  intermediate: 'intermédiaire (vocabulaire technique courant du domaine)',
  advanced: 'avancé (termes pointus, nuances entre notions proches)',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict conforme à courseResourcesContentSchema. */
export function resourcesSystemPrompt(): string {
  return [
    `Tu es un rédacteur pédagogique qui prépare les ressources complémentaires d'un cours Udemy.`,
    `Tu produis DEUX éléments à partir du plan du cours : un glossaire des termes clés et une liste de ressources « pour aller plus loin ».`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. "glossary" : entre 8 et 25 entrées couvrant le VOCABULAIRE RÉELLEMENT utilisé dans le plan du cours (pas de termes hors sujet). Un "term" court (1-4 mots) et une "definition" claire de 1-3 phrases, autonome (compréhensible sans avoir suivi le cours).`,
    `2. Le glossaire est trié par ORDRE ALPHABÉTIQUE du "term".`,
    `3. "furtherResources" : entre 4 et 10 ressources variées (documentation officielle, article de référence, outil, livre, dépôt d'exemples…). Chaque ressource a un "title", un "kind" (type court : « Documentation », « Article », « Outil », « Livre »…), une "description" (1-2 phrases expliquant l'intérêt) et optionnellement une "url".`,
    `4. Les "url" fournies doivent être des adresses PLAUSIBLES de sites de référence reconnus du domaine (documentation officielle, MDN, sites d'organismes connus…) — jamais d'URL inventée fantaisiste ; en cas de doute, omets l'url plutôt que d'en inventer une.`,
    `5. Aucune répétition entre entrées du glossaire ni entre ressources.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{`,
    `  "glossary": [ { "term": string, "definition": string } ],`,
    `  "furtherResources": [ { "title": string, "kind": string, "url"?: string, "description": string } ]`,
    `}`,
  ].join('\n');
}

/** Prompt utilisateur — le titre du cours est balisé « … » en premier (extraction mock). */
export function resourcesUserPrompt(input: ResourcesPromptInput): string {
  const { courseTitle, subtitle, difficulty, locale, outlineSummary } = input;
  const lines = [
    `Prépare le glossaire et les ressources complémentaires du cours « ${courseTitle} ».`,
    `Niveau : ${DIFFICULTY_LABELS[difficulty]}.`,
  ];
  if (subtitle) lines.push(`Sous-titre : ${subtitle}`);
  lines.push(`Plan du cours (sections et leçons couvertes) :`, outlineSummary);
  lines.push(`Tout le contenu doit être rédigé en ${LOCALE_LABELS[locale]}.`);
  return lines.join('\n');
}
