// Prompts du blog SEO automatique (Prompt 204) — DISTINCTS des prompts
// d'article de leçon (prompts/article.ts) : ici on écrit pour le référencement
// (mot-clé cible, intention de recherche, structure H2/H3, FAQ), pas pour un
// apprenant déjà inscrit. Sorties alignées sur blogPlanSchema / blogPostContentSchema.
import { BLOG, type Difficulty, type Locale, type SearchIntent } from '../shared.js';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'débutant',
  intermediate: 'intermédiaire',
  advanced: 'avancé',
};

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

const INTENT_LABELS: Record<SearchIntent, string> = {
  informational: "informationnelle — le lecteur cherche à COMPRENDRE (définitions, explications, comparatifs)",
  commercial: "commerciale — le lecteur compare des solutions avant de choisir (avis, alternatives, « meilleur… »)",
  transactional: "transactionnelle — le lecteur est prêt à passer à l'action (se former, acheter, démarrer)",
  navigational: 'navigationnelle — le lecteur cherche une ressource ou un outil précis',
};

export interface BlogPlanPromptInput {
  courseTitle: string;
  /** Description du cours (outline) — matière première des angles éditoriaux. */
  courseDescription?: string | undefined;
  /** Objectifs pédagogiques — sources naturelles de mots-clés longue traîne. */
  learningObjectives?: readonly string[] | undefined;
  difficulty: Difficulty;
  locale: Locale;
  /** Nombre d'articles attendus (BLOG_POSTS_PER_COURSE). */
  count: number;
}

/** Prompt système du plan éditorial : contrat de sortie JSON strict (blogPlanSchema). */
export function blogPlanSystemPrompt(): string {
  return [
    `Tu es un stratège SEO spécialisé dans l'acquisition organique pour des cours en ligne.`,
    `Tu construis le plan éditorial d'un blog dont l'unique objectif est d'attirer, via Google, des lecteurs qui finiront par s'inscrire au cours.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Un mot-clé cible UNIQUE par article (expression réellement tapée dans un moteur de recherche, longue traîne de préférence). Jamais deux articles sur le même mot-clé.`,
    `2. Les articles couvrent des intentions de recherche VARIÉES (informational, commercial, transactional, navigational) : le blog doit capter le lecteur à chaque étape.`,
    `3. Le titre contient le mot-clé cible, tel qu'il serait tapé, et donne envie de cliquer (pas de titre creux).`,
    `4. "angle" : une phrase qui dit ce que CET article apporte de différent des autres (aucun recouvrement).`,
    `5. Les sujets tournent autour de la thématique du cours SANS jamais paraphraser son plan : ce sont des articles autonomes, utiles hors du cours.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{ "posts": [ { "title": string, "keyword": string, "searchIntent": "informational" | "commercial" | "transactional" | "navigational", "angle": string } ] }`,
  ].join('\n');
}

/** Prompt utilisateur du plan (titre balisé « … » pour l'extraction mock). */
export function blogPlanUserPrompt(input: BlogPlanPromptInput): string {
  const lines = [
    `Construis le plan éditorial de ${input.count} articles de blog pour promouvoir le cours « ${input.courseTitle} ».`,
    `Niveau du public : ${DIFFICULTY_LABELS[input.difficulty]}`,
    `Langue de rédaction : ${LOCALE_LABELS[input.locale]}.`,
  ];
  if (input.courseDescription) lines.push(`Description du cours : ${input.courseDescription}`);
  if (input.learningObjectives?.length) {
    lines.push(`Objectifs pédagogiques du cours :`, ...input.learningObjectives.map((o) => `- ${o}`));
  }
  lines.push(`Produis EXACTEMENT ${input.count} articles, tous sur des mots-clés distincts.`);
  return lines.join('\n');
}

export interface BlogPostPromptInput {
  /** Titre de l'article (balisé « … » en tête du prompt pour l'extraction mock). */
  title: string;
  keyword: string;
  searchIntent: SearchIntent;
  angle: string;
  courseTitle: string;
  difficulty: Difficulty;
  locale: Locale;
  /** Titres des autres articles du lot — évite les doublons de contenu. */
  siblingTitles?: readonly string[] | undefined;
}

/** Prompt système d'un article SEO : contrat de sortie (blogPostContentSchema) + règles SEO. */
export function blogPostSystemPrompt(): string {
  return [
    `Tu es un rédacteur SEO senior : tes articles se classent en première page de Google ET se lisent avec plaisir.`,
    `Tu rédiges un article de blog complet, immédiatement publiable, en Markdown.`,
    ``,
    `RÈGLES IMPÉRATIVES DE L'ARTICLE :`,
    `1. Longueur : entre ${BLOG.MIN_WORDS} et ${BLOG.MAX_WORDS} mots (hors blocs de code).`,
    `2. Structure : uniquement des titres H2 (##) et H3 (###) — JAMAIS de H1, le titre est fourni à part. Au moins ${BLOG.MIN_H2_SECTIONS} sections H2.`,
    `3. Mot-clé cible : présent dans le titre, dans le premier paragraphe, et au moins ${BLOG.MIN_KEYWORD_OCCURRENCES} fois dans le corps — sans bourrage : la lecture doit rester naturelle.`,
    `4. "metaDescription" : entre ${BLOG.META_DESCRIPTION_MIN_CHARS} et ${BLOG.META_DESCRIPTION_MAX_CHARS} caractères, contient le mot-clé et donne envie de cliquer depuis la page de résultats.`,
    `5. "faq" : ${BLOG.MIN_FAQ_ENTRIES} à ${BLOG.MAX_FAQ_ENTRIES} vraies questions que se pose le lecteur, avec des réponses complètes et autonomes. Elle est affichée et balisée (FAQPage schema.org) à part : ne la recopie PAS dans le corps de l'article.`,
    `6. Contenu concret : exemples réalistes, chiffres et étapes actionnables, blocs de code fencés si le sujet est technique. Zéro remplissage, aucun lien externe inventé, aucune promesse mensongère.`,
    `7. N'insère AUCUN appel à l'action vers le cours ni aucun lien vers d'autres articles : ils sont ajoutés automatiquement après ta rédaction.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON (aucun texte autour, aucune fence Markdown) :`,
    `{ "title": string, "metaDescription": string, "markdown": string, "faq": [ { "question": string, "answer": string } ] }`,
  ].join('\n');
}

/** Prompt utilisateur d'un article (titre balisé « … » pour extraction mock). */
export function blogPostUserPrompt(input: BlogPostPromptInput): string {
  const lines = [
    `Rédige l'article de blog « ${input.title} ».`,
    `Mot-clé cible : ${input.keyword}`,
    `Intention de recherche : ${INTENT_LABELS[input.searchIntent]}`,
    `Angle éditorial : ${input.angle}`,
    `Cours promu (contexte, ne le cite pas explicitement dans le corps) : ${input.courseTitle} — niveau ${DIFFICULTY_LABELS[input.difficulty]}`,
    `Langue de rédaction : ${LOCALE_LABELS[input.locale]} (titre, corps, meta description et FAQ).`,
  ];
  if (input.siblingTitles?.length) {
    lines.push(
      `Autres articles déjà prévus sur ce blog — ne redis pas ce qu'ils couvrent :`,
      ...input.siblingTitles.map((t) => `- ${t}`),
    );
  }
  lines.push(`Vise ${BLOG.MIN_WORDS} à ${BLOG.MAX_WORDS} mots, avec la structure et la FAQ imposées.`);
  return lines.join('\n');
}
