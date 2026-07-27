// Prompts du script vidéo d'une leçon — sortie alignée sur slideScriptSchema,
// débit de narration calé sur AUDIO.NARRATION_WORDS_PER_MINUTE.
import { AUDIO, SLIDE_TEMPLATES, type Difficulty, type Locale } from '../shared.js';

export interface VideoScriptPromptInput {
  lessonTitle: string;
  /** Résumé de la leçon issu de l'outline (contexte pour le LLM). */
  summary?: string;
  /** Durée cible de la vidéo en minutes — pilote le volume de narration. */
  durationMin: number;
  courseTitle: string;
  difficulty: Difficulty;
  locale: Locale;
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant (tout expliquer, aucun jargon non défini, rythme posé)',
  intermediate: 'intermédiaire (bases acquises, aller droit à la pratique et aux cas réels)',
  advanced: 'avancé (public expérimenté, détails pointus, arbitrages et optimisation)',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : rôle d'instructeur + contrat de sortie JSON strict. */
export function videoScriptSystemPrompt(): string {
  return [
    `Tu es un instructeur vidéo expérimenté qui écrit des scripts de cours en ligne captivants.`,
    `Tu produis le script complet d'UNE vidéo de cours : les slides affichées et la narration lue mot à mot par une voix off.`,
    ``,
    `RÈGLES IMPÉRATIVES DU SCRIPT :`,
    `1. La narration est écrite pour être LUE À VOIX HAUTE : phrases courtes, ton d'instructeur naturel et direct, tutoiement ou vouvoiement cohérent du début à la fin.`,
    `2. INTERDIT de commencer par des formules creuses comme « dans cette vidéo nous allons » : entre directement dans le sujet avec un fait, une question ou un exemple concret.`,
    `3. Débit de référence : environ ${AUDIO.NARRATION_WORDS_PER_MINUTE} mots par minute. Le TOTAL des narrations doit correspondre à la durée cible demandée.`,
    `4. La PREMIÈRE slide utilise le template "title" (accroche + annonce du bénéfice) et la DERNIÈRE le template "recap" (synthèse des points clés).`,
    `5. Chaque slide intermédiaire choisit le template le plus adapté parmi : ${SLIDE_TEMPLATES.join(', ')}.`,
    `6. Template "code" : le champ "code" contient l'extrait complet et le champ "language" le langage ; la narration explique le code ligne par ligne.`,
    `7. Illustre chaque notion par au moins un exemple concret et chiffré ou manipulable ; jamais de généralités abstraites seules.`,
    `8. Soigne les transitions : la fin de la narration d'une slide amène naturellement la suivante (pas de rupture sèche).`,
    `9. Adapte vocabulaire et profondeur au niveau annoncé du cours.`,
    `10. "bullets" : 2 à 5 puces courtes affichées à l'écran (mots-clés, pas de phrases complètes) ; elles reprennent la narration sans la paraphraser mot pour mot. Une slide de contenu avec 0 ou 1 puce est INTERDITE : l'écran doit montrer ce que la voix explique.`,
    `11. Nombre de slides : environ UNE par minute de narration (ex. 6 à 9 slides pour 7 minutes). Chaque slide couvre une idée complète (~45-75 s de narration) — jamais une micro-étape de 10 secondes.`,
    `12. Chaque slide a un "title" COURT et UNIQUE qui nomme son idée (jamais le titre de la leçon répété, jamais « partie N »).`,
    `13. VARIE les gabarits : dès que la leçon manipule des commandes ou du code, au moins UNE slide "code" ; des étapes ordonnées → "timeline" ; deux approches opposées → "comparison". Jamais plus de 3 slides "bullets" d'affilée.`,
    `14. GRAMMAIRE IRRÉPROCHABLE : la narration est lue telle quelle par une voix off — vérifie chaque accord (genre : « CE garde-fou » ; sujets coordonnés : « la rapidité et la fiabilité PRIMENT ») et emploie la terminologie technique établie de la langue cible.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{`,
    `  "slides": [`,
    `    {`,
    `      "template": ${SLIDE_TEMPLATES.map((t) => `"${t}"`).join('|')},`,
    `      "title": string,`,
    `      "bullets": string[],`,
    `      "code": string (uniquement si template "code"),`,
    `      "language": string (uniquement si template "code"),`,
    `      "narration": string (texte lu mot à mot pendant cette slide),`,
    `      "notes": string (optionnel — indications internes, non lues)`,
    `    }`,
    `  ]`,
    `}`,
  ].join('\n');
}

/** Prompt utilisateur : paramètres de la leçon (titre balisé « … » pour extraction mock). */
export function videoScriptUserPrompt(input: VideoScriptPromptInput): string {
  const { lessonTitle, summary, durationMin, courseTitle, difficulty, locale, context } = input;
  const targetWords = Math.round(durationMin * AUDIO.NARRATION_WORDS_PER_MINUTE);
  const lines = [
    `Écris le script vidéo de la leçon « ${lessonTitle} ».`,
    `Cours : "${courseTitle}" — niveau ${DIFFICULTY_LABELS[difficulty]}.`,
    `Durée cible : ${durationMin} minutes, soit environ ${targetWords} mots de narration au total.`,
  ];
  if (summary) lines.push(`Résumé de la leçon (à respecter) : ${summary}`);
  if (context) lines.push('', context);
  lines.push(`Slides et narration intégralement rédigées en ${LOCALE_LABELS[locale]}.`);
  return lines.join('\n');
}
