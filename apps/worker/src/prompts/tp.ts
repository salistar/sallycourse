// Prompts du générateur de TP (Prompt 17) — sortie JSON conforme à tpSchema,
// avec screenshotSpec Playwright OBLIGATOIRE pour chaque étape sur ordinateur
// (contrat du module de capture P21).
import type { Difficulty, Locale } from '../shared.js';

export interface TpPromptInput {
  courseTitle: string;
  lessonTitle: string;
  /** Résumé de la leçon issu de l'outline (contexte pédagogique). */
  summary?: string;
  difficulty: Difficulty;
  locale: Locale;
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant (chaque étape est détaillée, aucun prérequis implicite)',
  intermediate: 'intermédiaire (bases acquises, étapes plus denses, cas réels)',
  advanced: 'avancé (public expérimenté, étapes exigeantes, pièges subtils)',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict conforme à tpSchema. */
export function tpSystemPrompt(): string {
  return [
    `Tu es un formateur technique senior qui rédige des travaux pratiques (TP) pour des cours Udemy.`,
    `Tes TP sont concrets, réalisables en autonomie et chaque étape est vérifiable par l'apprenant.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Le TP compte au moins 3 étapes ("steps"), ordonnées et progressives.`,
    `2. "environment" liste tout le nécessaire avant de commencer : outils, versions, comptes, fichiers.`,
    `3. Chaque étape a une "instruction" à l'impératif et un "expectedResult" observable et précis.`,
    `4. Si l'étape passe par un terminal, fournis la "command" exacte à exécuter.`,
    `5. CHAQUE étape réalisée sur ordinateur (navigateur, IDE, terminal, application) DOIT inclure un "screenshotSpec" : il sera rejoué TEL QUEL par Playwright pour produire la capture d'écran illustrant l'étape. Sans lui, l'étape n'aura aucune illustration.`,
    `6. Un "screenshotSpec" doit être autonome : fournis "url" (page de départ) OU commence "actions" par une action "goto" ; utilise des sélecteurs CSS robustes (id, attributs stables — jamais de classes générées) ; enchaîne les actions jusqu'à l'état exact à capturer.`,
    `7. Types d'actions autorisés : "goto" (value = URL), "click" (selector requis), "fill" (selector + value requis), "scroll" (value = pixels), "wait" (selector à attendre ou value = millisecondes).`,
    `8. "focusSelector" (optionnel) désigne l'élément à surligner sur la capture ; "caption" décrit ce que l'apprenant doit constater.`,
    `9. "validation" : liste de vérifications finales que l'apprenant coche pour confirmer la réussite du TP.`,
    `10. "troubleshooting" : erreurs fréquentes et leur remède, une entrée par problème (symptôme → solution).`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{`,
    `  "objective": string,`,
    `  "environment": string[],`,
    `  "steps": [`,
    `    {`,
    `      "instruction": string,`,
    `      "command"?: string,`,
    `      "expectedResult": string,`,
    `      "screenshotSpec"?: {`,
    `        "url"?: string,`,
    `        "actions": [ { "type": "goto"|"click"|"fill"|"scroll"|"wait", "selector"?: string, "value"?: string } ],`,
    `        "focusSelector"?: string,`,
    `        "caption": string`,
    `      }`,
    `    }`,
    `  ],`,
    `  "validation": string[],`,
    `  "troubleshooting": string[]`,
    `}`,
  ].join('\n');
}

/** Prompt utilisateur — le titre de la leçon est balisé « … » en premier (extraction mock). */
export function tpUserPrompt(input: TpPromptInput): string {
  const { courseTitle, lessonTitle, summary, difficulty, locale, context } = input;
  const lines = [
    `Rédige le TP complet de la leçon « ${lessonTitle} » du cours "${courseTitle}".`,
    `Niveau du cours : ${DIFFICULTY_LABELS[difficulty]}.`,
  ];
  if (summary) lines.push(`Résumé prévu de la leçon : ${summary}`);
  if (context) lines.push('', context);
  lines.push(
    `Tout le contenu du TP doit être rédigé en ${LOCALE_LABELS[locale]}.`,
    `Rappel : toute étape effectuée sur ordinateur doit inclure son "screenshotSpec" rejouable par Playwright.`,
  );
  return lines.join('\n');
}
