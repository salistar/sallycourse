// Prompts du générateur de quiz — bornes et format injectés depuis les
// constantes partagées (QUIZ), sortie = tableau JSON conforme à quizQuestionSchema.
import { QUIZ, type Difficulty, type Locale } from '../shared.js';

export interface QuizPromptInput {
  courseTitle: string;
  sectionTitle: string;
  lessonTitle: string;
  /** Niveau global du cours — sert de centre de gravité au mix de difficultés. */
  difficulty: Difficulty;
  locale: Locale;
  /** Leçons de la section (hors quiz) : matière première des questions et distracteurs. */
  sectionLessons?: readonly { title: string; summary?: string }[];
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant (notions fondamentales, vocabulaire, premiers réflexes)',
  intermediate: 'intermédiaire (mise en pratique, cas réels, choix entre approches)',
  advanced: 'avancé (subtilités, pièges, optimisation, arbitrages d’architecture)',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict (tableau de quizQuestionSchema). */
export function quizSystemPrompt(): string {
  return [
    `Tu es un expert en évaluation pédagogique pour des cours Udemy en ligne.`,
    `Tu rédiges des quiz QCM de fin de section qui vérifient la compréhension réelle, pas la mémorisation.`,
    ``,
    `RÈGLES IMPÉRATIVES DU QUIZ :`,
    `1. Entre ${QUIZ.MIN_QUESTIONS_PER_SECTION} et ${QUIZ.MAX_QUESTIONS_PER_SECTION} questions, portant UNIQUEMENT sur le contenu de la section fournie.`,
    `2. Chaque question a exactement ${QUIZ.CHOICES_PER_QUESTION} choix, tous distincts, une seule bonne réponse.`,
    `3. Mixe les difficultés ("beginner", "intermediate", "advanced") : au moins deux niveaux différents, réparti autour du niveau global du cours.`,
    `4. Les distracteurs sont PLAUSIBLES : erreurs courantes, confusions réelles entre notions proches, approximations tentantes — jamais des réponses absurdes ou hors sujet.`,
    `5. "explanation" est OBLIGATOIRE et complète : elle explique pourquoi la bonne réponse est correcte ET pourquoi chacune des autres propositions est fausse (réfute chaque distracteur, un par un).`,
    `6. Varie la position de la bonne réponse ("correctIndex") d'une question à l'autre.`,
    `7. Questions autonomes : compréhensibles sans revoir la leçon, sans référence du type « comme vu dans la vidéo ».`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un tableau JSON (aucun texte autour, aucune fence Markdown) :`,
    `[`,
    `  {`,
    `    "question": string,`,
    `    "choices": [string, string, string, string],`,
    `    "correctIndex": number (0 à ${QUIZ.CHOICES_PER_QUESTION - 1}),`,
    `    "explanation": string,`,
    `    "difficulty": "beginner" | "intermediate" | "advanced"`,
    `  }`,
    `]`,
  ].join('\n');
}

/** Prompt utilisateur : contexte de la section (titre balisé « … » pour extraction mock). */
export function quizUserPrompt(input: QuizPromptInput): string {
  const { courseTitle, sectionTitle, lessonTitle, difficulty, locale, sectionLessons, context } = input;
  const lines = [
    `Génère le quiz de fin de section « ${sectionTitle} » du cours « ${courseTitle} ».`,
    `Titre de la leçon quiz : ${lessonTitle}`,
    `Niveau global du cours : ${DIFFICULTY_LABELS[difficulty]}`,
    `Langue : toutes les questions, choix et explications sont rédigés en ${LOCALE_LABELS[locale]}.`,
  ];
  if (context) lines.push('', context);
  if (sectionLessons && sectionLessons.length > 0) {
    lines.push(
      ``,
      `Contenu couvert par la section (base des questions ET des distracteurs) :`,
      ...sectionLessons.map(
        (lesson) => `- ${lesson.title}${lesson.summary ? ` — ${lesson.summary}` : ''}`,
      ),
    );
  }
  return lines.join('\n');
}
