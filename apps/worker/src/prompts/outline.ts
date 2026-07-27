// Prompts de génération du plan de cours (outline) — règles Udemy injectées
// depuis les constantes partagées, format de sortie aligné sur outlineSchema.
import {
  UDEMY,
  OUTLINE_PLANNING_TARGET_MINUTES,
  type Difficulty,
  type Locale,
  type QuizPosition,
} from '../shared.js';

export interface OutlinePromptInput {
  title: string;
  difficulty: Difficulty;
  locale: Locale;
  /** Souhait utilisateur — jamais en dessous de UDEMY.MIN_SECTIONS. */
  approxSections?: number;
  /**
   * Import de contenu existant (Prompt 90, RAG simple) — extraits chunkés du
   * matériel source fourni par l'utilisateur (PDF/PPTX/Markdown), déjà
   * assemblés par buildSourceMaterialContext(). Absent/vide → comportement
   * inchangé (génération sans contexte source).
   */
  sourceMaterialExcerpt?: string;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant (aucun prérequis, progression très graduelle, vocabulaire expliqué)',
  intermediate: 'intermédiaire (bases acquises, focus sur la pratique et les cas réels)',
  advanced: 'avancé (public expérimenté, sujets pointus, optimisation et architecture)',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict conforme à outlineSchema. */
export function outlineSystemPrompt(sourceMaterialExcerpt?: string, quizPosition?: QuizPosition): string {
  // Règle de placement des quiz (P164, Phase 10) — par défaut 1 quiz/section.
  const quizRule =
    quizPosition === 'final-only'
      ? `4. NE mets PAS de quiz à chaque section : le cours se termine par UNE seule leçon de type "quiz", récapitulative et finale.`
      : quizPosition === 'mid-course'
        ? `4. NE mets PAS de quiz à chaque section : place UNE seule leçon de type "quiz" (bilan) vers le milieu du cours.`
        : `4. Chaque section se termine par exactement UNE leçon de type "quiz" (et une seule par section).`;
  return [
    `Tu es un ingénieur pédagogique senior spécialisé dans les cours Udemy à succès.`,
    `Tu produis des plans de cours complets, immédiatement exploitables par un pipeline automatisé.`,
    ``,
    ...(sourceMaterialExcerpt
      ? [
          `Base-toi sur cet extrait de matériel source fourni par l'utilisateur (PDF/PPTX/Markdown) pour structurer le plan : reprends sa progression, son vocabulaire et ses exemples autant que pertinent, sans le recopier mot pour mot.`,
          `--- DÉBUT DU MATÉRIEL SOURCE ---`,
          sourceMaterialExcerpt,
          `--- FIN DU MATÉRIEL SOURCE ---`,
          ``,
        ]
      : []),
    `RÈGLES IMPÉRATIVES DU PLAN :`,
    `1. Au moins ${UDEMY.MIN_SECTIONS} sections, ordonnées selon une progression pédagogique adaptée au niveau demandé.`,
    `2. Au moins ${OUTLINE_PLANNING_TARGET_MINUTES} minutes de vidéo au total (somme des durationMin des leçons de type "video") — vise cette cible avec marge, PAS le strict minimum : la narration réelle une fois synthétisée est souvent plus courte que l'estimation de durée (débit de lecture variable), et le plancher absolu à ne jamais franchir est de ${UDEMY.MIN_TOTAL_VIDEO_MINUTES} min.`,
    `3. Les types de leçons alternent entre "video", "article" et "tp" au sein de chaque section (pas de section mono-type).`,
    quizRule,
    `5. "title" du cours : ${UDEMY.TITLE_MAX_CHARS} caractères maximum.`,
    `6. "subtitle" : ${UDEMY.SUBTITLE_MAX_CHARS} caractères maximum, orienté bénéfices.`,
    `7. "learningObjectives" : entre ${UDEMY.MIN_LEARNING_OBJECTIVES} et 8 objectifs concrets et mesurables.`,
    `8. Chaque leçon a un "summary" d'une à deux phrases et une "durationMin" strictement positive.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{`,
    `  "title": string,`,
    `  "subtitle": string,`,
    `  "description": string (paragraphe vendeur et honnête, ~${UDEMY.DESCRIPTION_MIN_WORDS} mots),`,
    `  "learningObjectives": string[],`,
    `  "prerequisites": string[],`,
    `  "targetAudience": string[],`,
    `  "sections": [ { "title": string, "lessons": [ { "title": string, "type": "video"|"article"|"tp"|"quiz", "durationMin": number, "summary": string } ] } ]`,
    `}`,
  ].join('\n');
}

/** Prompt utilisateur : paramètres du cours (le titre est balisé « … » pour extraction). */
export function outlineUserPrompt(input: OutlinePromptInput): string {
  const { title, difficulty, locale, approxSections } = input;
  const sections = Math.max(approxSections ?? UDEMY.MIN_SECTIONS, UDEMY.MIN_SECTIONS);
  return [
    `Génère le plan complet d'un cours en ${LOCALE_LABELS[locale]}.`,
    `Titre du cours : « ${title} »`,
    `Niveau : ${DIFFICULTY_LABELS[difficulty]}`,
    `Nombre de sections visé : ${sections} (jamais moins de ${UDEMY.MIN_SECTIONS}).`,
    `Tout le contenu textuel du plan doit être rédigé en ${LOCALE_LABELS[locale]}.`,
  ].join('\n');
}
