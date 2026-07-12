// Prompts du générateur de séquences email marketing (Prompt 140) — sortie
// JSON conforme à emailSequenceGenerationSchema : liste d'étapes datées
// (delayDays/subject/bodyTemplate) pour un scénario donné (launch/nurturing/
// winback).
import type { EmailSequenceKind } from '../shared.js';

export interface EmailSequencePromptInput {
  courseTitle: string;
  kind: EmailSequenceKind;
  /** Nombre d'étudiants déjà inscrits (contexte, nurturing/winback). */
  enrollmentCount?: number;
}

const KIND_BRIEF: Record<EmailSequenceKind, string> = {
  launch: "une annonce de LANCEMENT du cours : 1 à 2 emails courts (le jour J puis une relance à J+2) qui créent l'envie de s'inscrire.",
  nurturing: "une séquence de NURTURING de 5 emails espacés sur plusieurs semaines, qui accompagnent un étudiant fraîchement inscrit (bienvenue, mise en avant d'une leçon clé, encouragement à progresser, étude de cas/preuve sociale, appel à terminer le cours).",
  winback: "une RELANCE d'étudiants INACTIFS (aucune activité récente) : 1 à 3 emails qui raniment la motivation sans culpabiliser, avec un rappel concret de ce qu'il reste à apprendre.",
};

/** Prompt système : contrat de sortie JSON strict conforme à emailSequenceGenerationSchema. */
export function emailSequenceSystemPrompt(): string {
  return [
    "Tu es un rédacteur en marketing par email spécialisé dans les cours en ligne (plateforme SALISTAR).",
    "Tu produis une séquence d'emails programmés à partir d'un brief.",
    "",
    "RÈGLES IMPÉRATIVES :",
    '1. "steps" : liste ordonnée par "delayDays" CROISSANT (jours après le déclenchement de la séquence, 0 = immédiat).',
    '2. Chaque "subject" est court (< 70 caractères), concret, sans clickbait ni majuscules criardes.',
    '3. Chaque "bodyTemplate" est un corps d\'email en FRANÇAIS, ton chaleureux et direct, 3 à 6 phrases, qui peut utiliser les variables {{name}} et {{courseTitle}} (remplacées à l\'envoi) — n\'invente pas d\'autres variables.',
    "4. Pas de promesses mensongères, pas de fausse urgence artificielle.",
    "",
    "FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :",
    '{"steps":[{"delayDays":number,"subject":string,"bodyTemplate":string}]}',
  ].join('\n');
}

/** Prompt utilisateur : brief concret (cours, type de séquence, contexte). */
export function emailSequenceUserPrompt(input: EmailSequencePromptInput): string {
  const brief = KIND_BRIEF[input.kind];
  const context =
    input.enrollmentCount !== undefined
      ? `Contexte : ${input.enrollmentCount} étudiant(s) concerné(s) par cette séquence.`
      : '';
  return [
    `Cours : « ${input.courseTitle} ».`,
    `Type de séquence demandée : ${input.kind}.`,
    `Brief : rédige ${brief}`,
    context,
    "Réponds avec l'objet JSON attendu.",
  ]
    .filter(Boolean)
    .join('\n');
}
