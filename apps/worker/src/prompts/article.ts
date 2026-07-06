// Prompts de génération d'un article de leçon — bornes rédactionnelles
// injectées depuis les constantes partagées, sortie alignée sur articleContentSchema.
import { ARTICLE, type Difficulty, type Locale } from '../shared.js';

export interface ArticlePromptInput {
  /** Titre de la leçon (balisé « … » en tête du prompt pour l'extraction mock). */
  lessonTitle: string;
  courseTitle: string;
  /** Résumé de la leçon issu de l'outline (contexte rédactionnel). */
  summary?: string | undefined;
  difficulty: Difficulty;
  locale: Locale;
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant — tout terme technique est défini à sa première apparition',
  intermediate: 'intermédiaire — bases acquises, focus sur la pratique et les cas réels',
  advanced: 'avancé — public expérimenté, place aux détails pointus et aux compromis',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : contrat de sortie JSON strict conforme à articleContentSchema. */
export function articleSystemPrompt(): string {
  return [
    `Tu es un rédacteur pédagogique senior pour des cours Udemy à succès.`,
    `Tu rédiges des articles de leçon complets, immédiatement publiables, en Markdown.`,
    ``,
    `RÈGLES IMPÉRATIVES DE L'ARTICLE :`,
    `1. Longueur : entre ${ARTICLE.MIN_WORDS} et ${ARTICLE.MAX_WORDS} mots (hors blocs de code).`,
    `2. Structure : uniquement des titres H2 (##) et H3 (###) — jamais de H1, le titre est fourni à part. Au moins ${ARTICLE.MIN_H2_SECTIONS} sections H2.`,
    `3. Sujet technique : inclure des blocs de code fencés avec le langage (\`\`\`python, \`\`\`js, …), courts et commentés.`,
    `4. Encadrés : au moins un blockquote commençant EXACTEMENT par "> **À retenir**" qui synthétise les points clés.`,
    `5. Captures d'écran : insérer 2 à 4 placeholders {{screenshot:description précise de ce que doit montrer la capture}} aux endroits où une image aiderait. Description autoporteuse (écran, action, résultat attendu).`,
    `6. Ton concret et direct : exemples réalistes, zéro remplissage, pas de liens externes inventés.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{ "title": string, "markdown": string }`,
  ].join('\n');
}

/** Prompt utilisateur : contexte de la leçon (titre balisé « … » pour extraction mock). */
export function articleUserPrompt(input: ArticlePromptInput): string {
  const { lessonTitle, courseTitle, summary, difficulty, locale } = input;
  const lines = [
    `Rédige l'article de la leçon « ${lessonTitle} ».`,
    `Cours : ${courseTitle}`,
    `Niveau du public : ${DIFFICULTY_LABELS[difficulty]}`,
  ];
  if (summary) lines.push(`Résumé attendu de la leçon : ${summary}`);
  lines.push(
    `Langue de rédaction : ${LOCALE_LABELS[locale]} (tout le contenu, y compris les titres et encadrés).`,
    `Vise ${ARTICLE.MIN_WORDS} à ${ARTICLE.MAX_WORDS} mots, avec les encadrés et placeholders imposés.`,
  );
  return lines.join('\n');
}
