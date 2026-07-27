// Fixtures déterministes pour MOCK_PROVIDERS=true (ou clé API absente) :
// aucun appel payant, contenus français réalistes paramétrés par le titre.
// Le même titre produit toujours exactement la même fixture (hash FNV-1a).
import { z } from 'zod';
import {
  ARTICLE,
  AUDIO,
  BLOG,
  MARKETING_TITLE_IDEAS,
  QUIZ,
  UDEMY,
  altTextResultSchema,
  blogPlanSchema,
  blogPostContentSchema,
  courseFlashcardsSchema,
  courseResourcesContentSchema,
  marketingSchema,
  outlineSchema,
  quizQuestionSchema,
  slideScriptSchema,
  type AltTextResult,
  type BlogPlan,
  type BlogPostContent,
  type CourseFlashcards,
  type CourseResourcesContent,
  type MarketingContent,
  type Outline,
  type QuizQuestion,
  type SearchIntent,
  type Slide,
  type SlideScript,
  type SlideTemplate,
} from '../shared.js';

// ── Déterminisme ────────────────────────────────────────────────
/** Hash FNV-1a 32 bits — stable, rapide, suffisant pour dériver des variantes. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Choix déterministe dans une liste, dérivé du titre et d'un sel. */
function pick<T>(title: string, salt: string, list: readonly T[]): T {
  const value = list[hashString(`${salt}:${title}`) % list.length];
  // list est toujours non vide dans ce module — garde pour noUncheckedIndexedAccess.
  if (value === undefined) throw new Error('pick: liste vide');
  return value;
}

/**
 * Extrait le titre du cours depuis un prompt utilisateur : guillemets français
 * (« … », posés par nos prompts), sinon ligne "Titre … : …", sinon tronque.
 */
export function extractTitleFromPrompt(user: string): string {
  const guillemets = /«\s*([^»]+?)\s*»/.exec(user);
  if (guillemets?.[1]) return guillemets[1];
  const ligne = /titre[^:\n]*:\s*"?([^"\n]+)"?/i.exec(user);
  if (ligne?.[1]) return ligne[1].trim();
  return user.trim().slice(0, UDEMY.TITLE_MAX_CHARS) || 'Cours SallyCourse';
}

// ── Outline (5 sections / 22 leçons) ────────────────────────────
/** Thèmes de sections plausibles, indépendants du domaine du cours. */
const SECTION_THEMES = [
  'Découverte et mise en place',
  'Les fondamentaux indispensables',
  'Mise en pratique guidée',
  'Techniques avancées',
  'Projet final et bonnes pratiques',
] as const;

/** Séquences de types par section : 22 leçons dont 1 quiz en fin de chaque section. */
const SECTION_LESSON_TYPES: readonly (readonly ('video' | 'article' | 'tp')[])[] = [
  ['video', 'article', 'video', 'tp'],
  ['video', 'article', 'video'],
  ['video', 'tp', 'video'],
  ['video', 'article', 'video'],
  ['video', 'article', 'video', 'tp'],
];

const LESSON_TITLE_TEMPLATES = {
  video: ['Comprendre %s', 'Démonstration : %s', 'Pas à pas : %s', '%s en pratique'],
  article: ['Mémo : %s', 'Guide de référence — %s', 'Approfondir %s'],
  tp: ['TP : %s', 'Atelier pratique — %s', 'Exercice guidé : %s'],
} as const;

const LESSON_TOPICS = [
  'les concepts clés',
  "l'environnement de travail",
  'les premiers réglages',
  'la structure du projet',
  'les cas d’usage courants',
  'les erreurs fréquentes',
  'les outils du quotidien',
  'l’optimisation',
  'le débogage',
  'la mise en production',
  'les tests',
  'les bonnes pratiques',
] as const;

/**
 * Plan de cours mock : 5 sections / 22 leçons (quiz en fin de section),
 * ≥ 30 min de vidéo, conforme à outlineSchema et aux règles Udemy.
 */
export function mockOutline(title: string): Outline {
  const shortTitle = title.trim().slice(0, UDEMY.TITLE_MAX_CHARS) || 'Cours SallyCourse';
  const seed = hashString(shortTitle);

  const sections = SECTION_THEMES.map((theme, sIndex) => {
    const types = SECTION_LESSON_TYPES[sIndex] ?? ['video', 'article', 'video'];
    const lessons: Outline['sections'][number]['lessons'] = types.map((type, lIndex) => {
      const topic = LESSON_TOPICS[(seed + sIndex * 5 + lIndex) % LESSON_TOPICS.length] ?? 'les concepts clés';
      const template = pick(shortTitle, `lesson:${sIndex}:${lIndex}:${type}`, LESSON_TITLE_TEMPLATES[type]);
      return {
        title: template.replace('%s', topic),
        type,
        // Vidéos ~6 min (10 vidéos → 60 min ≥ MIN_TOTAL_VIDEO_MINUTES), articles/TP plus courts.
        durationMin: type === 'video' ? 6 : type === 'tp' ? 12 : 4,
        summary: `Leçon ${lIndex + 1} de la section « ${theme} » : ${topic} appliqués à ${shortTitle}.`,
      };
    });
    lessons.push({
      title: `Quiz — ${theme}`,
      type: 'quiz',
      durationMin: 5,
      summary: `Validez vos acquis de la section « ${theme} » (${QUIZ.MIN_QUESTIONS_PER_SECTION} questions minimum).`,
    });
    return { title: `${theme}`, lessons };
  });

  const outline: Outline = {
    title: shortTitle,
    subtitle: `Maîtrisez ${shortTitle} pas à pas : théorie, ateliers pratiques et quiz`.slice(
      0,
      UDEMY.SUBTITLE_MAX_CHARS,
    ),
    description:
      `Cette formation complète sur ${shortTitle} vous accompagne de la découverte jusqu'à l'autonomie. ` +
      `Vous alternerez vidéos courtes, articles de référence et travaux pratiques, avec un quiz de validation ` +
      `à la fin de chaque section. À l'issue du cours, vous saurez appliquer ${shortTitle} sur des cas réels, ` +
      `éviter les pièges classiques et adopter les bonnes pratiques du métier.`,
    learningObjectives: [
      `Comprendre les concepts fondamentaux de ${shortTitle}`,
      `Mettre en place un environnement de travail complet`,
      `Réaliser des travaux pratiques guidés de bout en bout`,
      `Diagnostiquer et corriger les erreurs les plus fréquentes`,
      `Appliquer les bonnes pratiques professionnelles`,
    ],
    prerequisites: ['Aucun prérequis technique — un ordinateur et de la motivation suffisent'],
    targetAudience: [
      `Débutants souhaitant découvrir ${shortTitle}`,
      'Professionnels en reconversion ou en montée en compétences',
    ],
    sections,
  };

  // Garantie interne : la fixture doit toujours satisfaire le schéma partagé.
  return outlineSchema.parse(outline);
}

// ── Script vidéo ────────────────────────────────────────────────
export const mockVideoScriptSchema = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  slides: z.array(
    z.object({
      heading: z.string().min(1),
      bullets: z.array(z.string()).min(1),
      narration: z.string().min(1),
    }),
  ).min(3),
  durationMin: z.number().positive(),
  cta: z.string().min(1),
});
export type MockVideoScript = z.infer<typeof mockVideoScriptSchema>;

export function mockVideoScript(title: string): MockVideoScript {
  const t = title.trim() || 'la leçon';
  const hooks = [
    `Dans cette vidéo, on attaque ${t} avec un exemple concret dès la première minute.`,
    `Vous vous demandez comment aborder ${t} sans vous perdre ? Suivez le guide.`,
    `Objectif de cette vidéo : rendre ${t} limpide en moins de dix minutes.`,
  ] as const;
  const slides = ['Contexte et objectif', 'Démonstration guidée', 'Pièges à éviter', 'Récapitulatif'].map(
    (heading, i) => ({
      heading,
      bullets: [
        `Point clé ${i + 1} sur ${t}`,
        `Exemple concret appliqué à ${t}`,
        'À retenir pour la suite du cours',
      ],
      narration:
        `${heading} : nous détaillons ici ${t}, en montrant chaque étape à l'écran. ` +
        `Prenez le temps de reproduire la manipulation de votre côté avant de passer à la suite.`,
    }),
  );
  // Durée dérivée du volume de narration (débit AUDIO.NARRATION_WORDS_PER_MINUTE).
  const words = slides.reduce((acc, s) => acc + s.narration.split(/\s+/).length, 0);
  return mockVideoScriptSchema.parse({
    title: t,
    hook: pick(t, 'hook', hooks),
    slides,
    durationMin: Math.max(3, Math.round(words / AUDIO.NARRATION_WORDS_PER_MINUTE) + 4),
    cta: 'Passez maintenant à la leçon suivante pour mettre tout cela en pratique.',
  });
}

// ── Script vidéo « slides » (slideScriptSchema, Prompt 15) ──────
/** Extrait la durée cible (minutes) d'un prompt « Durée cible : N minutes ». */
export function extractDurationMinFromPrompt(user: string): number {
  const match = /durée\s+cible[^0-9]*(\d+)/i.exec(user);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
}

/** Phrases de narration recombinables — aucune n'ouvre par « dans cette vidéo nous allons ». */
const NARRATION_SENTENCES = [
  `Regardez bien cet exemple : il résume à lui seul l'essentiel de %s.`,
  `Concrètement, %s se manipule en trois gestes simples que je vous montre à l'écran.`,
  `Prenez le temps de reproduire chaque étape de votre côté avant de poursuivre.`,
  `L'erreur classique ici, c'est d'aller trop vite : vérifiez chaque paramètre un par un.`,
  `Notez ce point, il reviendra dans le travail pratique de la section.`,
  `Ce comportement s'explique simplement, et une fois compris, vous ne l'oublierez plus.`,
  `Comparez les deux approches : la seconde est plus verbeuse mais bien plus robuste.`,
  `Gardez cette règle en tête, elle vous évitera la majorité des pièges du quotidien.`,
] as const;

/** Narration déterministe d'environ `targetWords` mots, dérivée du titre et d'un sel. */
function mockNarration(title: string, salt: string, targetWords: number): string {
  const offset = hashString(`${salt}:${title}`) % NARRATION_SENTENCES.length;
  const parts: string[] = [];
  let words = 0;
  for (let i = 0; words < targetWords; i++) {
    const template = NARRATION_SENTENCES[(offset + i) % NARRATION_SENTENCES.length] ?? '%s.';
    const sentence = template.replace('%s', title);
    parts.push(sentence);
    words += sentence.split(/\s+/).length;
  }
  return parts.join(' ');
}

/** Templates des slides intermédiaires (la 1re est 'title', la dernière 'recap'). */
const MIDDLE_TEMPLATES: readonly SlideTemplate[] = ['content', 'code', 'comparison', 'diagram', 'quote'];

/**
 * Script vidéo mock conforme à slideScriptSchema : 1re slide 'title', dernière
 * 'recap', volume de narration calé sur durationMin × débit AUDIO. Déterministe.
 */
export function mockSlideScript(title: string, durationMin: number = 6): SlideScript {
  const t = title.trim() || 'la leçon';
  const targetWords = Math.max(1, Math.round(durationMin * AUDIO.NARRATION_WORDS_PER_MINUTE));
  // ~1 slide intermédiaire toutes les 1,5 min, bornée entre 2 et 8.
  const middleCount = Math.min(8, Math.max(2, Math.round(durationMin / 1.5)));
  const totalSlides = middleCount + 2;
  const wordsPerSlide = Math.ceil(targetWords / totalSlides);

  const slides: Slide[] = [];
  slides.push({
    template: 'title',
    title: t,
    bullets: [`Objectif : maîtriser ${t}`, 'Exemple concret dès la première minute', 'À reproduire de votre côté'],
    narration: mockNarration(t, 'slide:title', wordsPerSlide),
  });
  for (let i = 0; i < middleCount; i++) {
    const template = MIDDLE_TEMPLATES[(hashString(`tpl:${i}:${t}`) % MIDDLE_TEMPLATES.length)] ?? 'content';
    const slide: Slide = {
      template,
      title: `${t} — étape ${i + 1}`,
      bullets: [`Point clé ${i + 1}`, `Exemple appliqué à ${t}`, 'À retenir pour le TP'],
      narration: mockNarration(t, `slide:${i}`, wordsPerSlide),
    };
    if (template === 'code') {
      slide.code = `// Exemple minimal appliqué à ${t}\nconst resultat = appliquer('${t}');\nconsole.log(resultat);`;
      slide.language = 'javascript';
    }
    slides.push(slide);
  }
  slides.push({
    template: 'recap',
    title: `Récapitulatif — ${t}`,
    bullets: ['Les points clés en un coup d’œil', 'Les pièges à éviter', 'Prochaine étape : le quiz de section'],
    narration: mockNarration(t, 'slide:recap', wordsPerSlide),
  });

  // Garantie interne : la fixture doit toujours satisfaire le schéma partagé.
  return slideScriptSchema.parse({ slides });
}

// ── Article ─────────────────────────────────────────────────────
export const mockArticleSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(100),
  readingTimeMin: z.number().positive(),
});
export type MockArticle = z.infer<typeof mockArticleSchema>;

/** Mots d'un Markdown, blocs de code fencés exclus (même règle que le générateur). */
function markdownWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Article mock conforme aux règles rédactionnelles du générateur (Prompt 16) :
 * ARTICLE.MIN_WORDS à MAX_WORDS mots, sections H2/H3, bloc de code, encadrés
 * `> **À retenir**` et placeholders {{screenshot:…}}. Déterministe par titre.
 */
export function mockArticle(title: string): MockArticle {
  const t = title.trim() || 'la notion étudiée';

  const skeleton = [
    `## Pourquoi ${t} compte vraiment`,
    `${t} revient dans la quasi-totalité des projets réels : bien le comprendre vous fera gagner un temps précieux. ` +
      `Dans cet article, nous posons le vocabulaire, montrons un exemple complet puis listons les pièges les plus fréquents. ` +
      `Gardez cet article sous la main : il sert de mémo pendant les travaux pratiques de la section.`,
    '',
    `{{screenshot:Vue d'ensemble de l'environnement de travail prêt pour ${t}, avec les panneaux principaux visibles}}`,
    '',
    '### Les points essentiels',
    `- Définition claire et vocabulaire de ${t}`,
    '- Quand l’utiliser (et quand s’en passer)',
    '- Exemple minimal commenté, étape par étape',
    '',
    `> **À retenir** : commencez toujours par le cas le plus simple de ${t}, vérifiez le résultat, puis complexifiez progressivement.`,
    '',
    '## Mise en place pas à pas',
    `Avant d'appliquer ${t}, préparez un environnement propre : un dossier de travail dédié, les outils installés ` +
      `et un exemple de départ minimal. Cette discipline évite la moitié des erreurs constatées chez les débutants.`,
    '',
    '```bash',
    '# Préparation du dossier de travail',
    'mkdir atelier && cd atelier',
    '# Vérifiez votre installation avant de continuer',
    'echo "environnement prêt"',
    '```',
    '',
    `{{screenshot:Terminal montrant la sortie « environnement prêt » après l'exécution des commandes de préparation}}`,
    '',
    '## Exemple guidé et pièges courants',
    `Prenons un cas simple : nous appliquons ${t} à un scénario réaliste, en expliquant chaque décision. ` +
      `L'objectif n'est pas d'aller vite, mais de comprendre pourquoi chaque étape existe et ce qui se passerait si on la sautait.`,
    '',
    '### Ce qui bloque le plus souvent',
    `La première erreur consiste à vouloir tout appliquer d'un coup : isolez chaque changement et validez-le séparément. ` +
      `La deuxième est de négliger la lecture des messages d'erreur, qui décrivent presque toujours la cause exacte du problème.`,
    '',
    `> **À retenir** : un problème avec ${t} se diagnostique en relisant le dernier changement effectué, pas en recommençant de zéro.`,
    '',
    '## Aller plus loin',
  ].join('\n');

  // Complément déterministe jusqu'au plancher de mots du générateur (puis stop :
  // on reste très en dessous du plafond ARTICLE.MAX_WORDS).
  const fillers = [
    `Dans un projet d'équipe, documentez la façon dont ${t} est appliqué chez vous : conventions, limites choisies et exemples internes. Cette documentation courte évite les débats répétés et accélère l'intégration des nouveaux arrivants.`,
    `Entraînez-vous à expliquer ${t} à voix haute en une minute : si l'explication reste confuse, revenez à l'exemple guidé ci-dessus et refaites-le en changeant un seul paramètre à la fois pour observer précisément son effet.`,
    `Comparez toujours votre résultat à un cas de référence connu. L'écart entre les deux vous indique immédiatement si le problème vient de votre compréhension de ${t} ou d'un détail d'environnement propre à votre machine.`,
    `Planifiez une révision rapide quelques jours après cette leçon : dix minutes suffisent pour refaire l'exemple minimal de mémoire, et c'est le moyen le plus fiable de transformer cette lecture en compétence durable.`,
    `Notez enfin les questions restées ouvertes pendant votre lecture : la plupart trouveront réponse dans les leçons suivantes de la section, et les autres feront d'excellents sujets à tester par vous-même dans le TP.`,
  ] as const;

  const paragraphs: string[] = [];
  let markdown = skeleton;
  for (let i = 0; markdownWords(markdown) < ARTICLE.MIN_WORDS; i++) {
    const filler = fillers[i % fillers.length] ?? fillers[0];
    paragraphs.push(filler);
    markdown = `${skeleton}\n${paragraphs.join('\n\n')}`;
  }

  const readingTimeMin = Math.max(1, Math.round(markdownWords(markdown) / 200));
  return mockArticleSchema.parse({ title: t, markdown, readingTimeMin });
}

// ── Travaux pratiques ───────────────────────────────────────────
export const mockTpSchema = z.object({
  title: z.string().min(1),
  objective: z.string().min(1),
  steps: z.array(z.string().min(1)).min(3),
  expectedResult: z.string().min(1),
  hints: z.array(z.string()).min(1),
});
export type MockTp = z.infer<typeof mockTpSchema>;

export function mockTp(title: string): MockTp {
  const t = title.trim() || 'le sujet du TP';
  return mockTpSchema.parse({
    title: `TP : ${t}`,
    objective: `Mettre en pratique ${t} sur un cas concret, en autonomie guidée.`,
    steps: [
      `Préparez votre environnement comme vu dans la section précédente.`,
      `Reproduisez l'exemple de référence lié à ${t}.`,
      `Adaptez-le à votre propre cas en modifiant au moins deux paramètres.`,
      `Vérifiez le résultat et notez ce qui vous a surpris.`,
    ],
    expectedResult: `Un résultat fonctionnel démontrant votre maîtrise de ${t}, prêt à être comparé au corrigé.`,
    hints: [
      'Relisez le mémo de la section si vous bloquez plus de dix minutes.',
      'Les erreurs font partie de l’apprentissage : lisez les messages attentivement.',
    ],
  });
}

// ── Marketing du cours (Prompt 28) ──────────────────────────────
/** Phrases recombinables de la description Udemy mock (aucun superlatif creux). */
const MARKETING_SENTENCES = [
  `Cette formation complète sur %s vous emmène de la découverte jusqu'à l'autonomie, avec une progression pensée pour la pratique.`,
  `Chaque section alterne vidéos courtes, articles de référence et travaux pratiques guidés, puis se termine par un quiz de validation.`,
  `Vous apprendrez à installer votre environnement, à appliquer %s sur des cas réels et à diagnostiquer les erreurs les plus fréquentes.`,
  `Les exemples sont concrets et reproductibles : vous manipulez à chaque leçon, au lieu d'accumuler de la théorie abstraite.`,
  `À la fin du cours, vous saurez mener un projet complet avec %s, en suivant les bonnes pratiques professionnelles du domaine.`,
  `Ce cours s'adresse aux débutants motivés comme aux professionnels en reconversion qui veulent des résultats mesurables rapidement.`,
  `Vous repartez avec des mémos réutilisables, des corrigés détaillés et une méthode de travail applicable dès demain.`,
  `Inscrivez-vous dès maintenant et faites votre première manipulation de %s dans les dix prochaines minutes.`,
] as const;

/** Préfixes distincts d'idées de titres — les slices à TITLE_MAX_CHARS restent uniques. */
const TITLE_IDEA_TEMPLATES = [
  `%s : la formation complète`,
  `Maîtrisez %s de A à Z`,
  `%s pour les impatients : passez à la pratique`,
  `Le guide pratique de %s (ateliers inclus)`,
  `%s sans jargon : méthode pas à pas`,
] as const;

const TITLE_IDEA_REASONS = [
  `Promesse d'exhaustivité claire, mot-clé principal en tête de titre.`,
  `Formulation orientée résultat, très recherchée sur les plateformes de cours.`,
  `Cible les apprenants pressés et met la pratique en avant.`,
  `Le mot « pratique » et la mention des ateliers rassurent sur le format.`,
  `« Sans jargon » lève la peur du débutant et se démarque des titres génériques.`,
] as const;

/**
 * Landing marketing mock conforme à marketingSchema ET aux règles métier du
 * générateur (description >= UDEMY.DESCRIPTION_MIN_WORDS mots, 5 titres
 * distincts <= TITLE_MAX_CHARS). Déterministe par titre.
 */
export function mockMarketing(title: string): MarketingContent {
  const t = title.trim().slice(0, UDEMY.TITLE_MAX_CHARS) || 'Cours SallyCourse';

  // Description : phrases recombinées jusqu'à dépasser le plancher SEO Udemy.
  const offset = hashString(`marketing:${t}`) % MARKETING_SENTENCES.length;
  const parts: string[] = [];
  let words = 0;
  for (let i = 0; words < UDEMY.DESCRIPTION_MIN_WORDS + 20; i++) {
    const template = MARKETING_SENTENCES[(offset + i) % MARKETING_SENTENCES.length] ?? '%s.';
    const sentence = template.replace(/%s/g, t);
    parts.push(sentence);
    words += sentence.split(/\s+/).filter(Boolean).length;
  }
  const udemyDescription = parts.join(' ');

  // Tronque le titre DANS le gabarit (jamais le texte fixe) : les 5 idées
  // restent distinctes même quand le titre du cours frôle TITLE_MAX_CHARS.
  const titleIdeas = TITLE_IDEA_TEMPLATES.map((template, i) => {
    const room = Math.max(8, UDEMY.TITLE_MAX_CHARS - template.replace('%s', '').length);
    const shortT = t.length > room ? `${t.slice(0, room - 1).trimEnd()}…` : t;
    return {
      title: template.replace('%s', shortT),
      score: 60 + (hashString(`${t}:idea:${i}`) % 40),
      reason: TITLE_IDEA_REASONS[i] ?? 'Variante orientée bénéfice.',
    };
  });

  return marketingSchema.parse({
    udemyDescription,
    welcomeMessage:
      `Bienvenue dans « ${t} » ! Vous venez de faire le premier pas : commencez dès maintenant par la première vidéo ` +
      `de la section 1, elle ne dure que quelques minutes. Avancez à votre rythme — chaque leçon se termine par une action concrète.`,
    congratsMessage:
      `Félicitations, vous avez terminé « ${t} » ! Vous êtes passé de la découverte à un projet complet, quiz validés à l'appui. ` +
      `Mettez vos acquis en pratique cette semaine, et si le cours vous a aidé, laissez un avis : cela aide d'autres apprenants à se lancer.`,
    promoText:
      `Passez de zéro à opérationnel sur ${t} : vidéos courtes, ateliers guidés et quiz de validation à chaque étape. ` +
      `Une méthode 100 % pratique, sans jargon inutile.`,
    titleIdeas: titleIdeas.slice(0, MARKETING_TITLE_IDEAS),
  });
}

// ── Ressources téléchargeables du cours (Prompt 65) ─────────────
/** Termes génériques recombinés avec le titre — glossaire toujours trié alphabétiquement. */
const GLOSSARY_TERM_TEMPLATES = [
  'Architecture',
  'Bonnes pratiques',
  'Cas d’usage',
  'Configuration',
  'Dépendance',
  'Environnement',
  'Fondamentaux',
  'Itération',
  'Performance',
  'Sécurité',
] as const;

const RESOURCE_KIND_TEMPLATES = [
  { kind: 'Documentation', title: 'Documentation officielle' },
  { kind: 'Article', title: 'Article de référence' },
  { kind: 'Outil', title: 'Outil complémentaire' },
  { kind: 'Communauté', title: 'Forum de la communauté' },
] as const;

/**
 * Glossaire + ressources mock conformes à courseResourcesContentSchema.
 * Déterministe par titre : mêmes entrées pour un même cours.
 */
export function mockCourseResources(title: string): CourseResourcesContent {
  const t = title.trim() || 'le cours';
  const glossary = GLOSSARY_TERM_TEMPLATES.map((term) => ({
    term: `${term} (${t})`,
    definition: `Notion de « ${term.toLowerCase()} » appliquée à ${t} : élément clé abordé dans le plan du cours.`,
  })).sort((a, b) => a.term.localeCompare(b.term, 'fr'));

  const furtherResources = RESOURCE_KIND_TEMPLATES.map(({ kind, title: kindTitle }, i) => ({
    title: `${kindTitle} — ${t}`,
    kind,
    description: `Ressource complémentaire pour approfondir ${t} au-delà du contenu du cours.`,
    ...(hashString(`${t}:resource:${i}`) % 2 === 0
      ? {}
      : { url: `https://example.org/${t.toLowerCase().replace(/\s+/g, '-')}-${i}` }),
  }));

  return courseResourcesContentSchema.parse({ glossary, furtherResources });
}

// ── Flashcards du cours (Prompt 203) ────────────────────────────
/** Angles de révision recombinés avec le titre — une notion par carte, sans redite. */
const FLASHCARD_ANGLES = [
  { front: 'Que désigne %s en une phrase ?', back: 'Notion centrale du cours : %s, présentée dès la première section.' },
  { front: 'Quel problème %s résout-il concrètement ?', back: 'Il évite le travail manuel répétitif et fiabilise le résultat.' },
  { front: 'Quel est le prérequis avant de commencer avec %s ?', back: 'Un environnement de travail propre et un exemple de départ minimal.' },
  { front: 'Citez une bonne pratique appliquée à %s.', back: 'Isoler chaque changement et le valider séparément avant de complexifier.' },
  { front: 'Quelle est l’erreur la plus fréquente avec %s ?', back: 'Tout appliquer d’un coup, sans vérifier le cas le plus simple d’abord.' },
  { front: 'Comment diagnostiquer un problème lié à %s ?', back: 'Relire le dernier changement effectué et le message d’erreur, plutôt que recommencer de zéro.' },
  { front: 'Quand faut-il éviter %s ?', back: 'Quand le cas d’usage est trop simple pour justifier la mise en place.' },
  { front: 'Quel outil du quotidien accompagne %s ?', back: 'Les outils vus dans la section « Les outils du quotidien » du cours.' },
  { front: 'Comment teste-t-on un résultat obtenu avec %s ?', back: 'En le comparant à un cas de référence connu, écart par écart.' },
  { front: 'Quelle étape précède la mise en production de %s ?', back: 'La validation par les tests et la relecture des bonnes pratiques.' },
  { front: 'Que retenir de la structure d’un projet %s ?', back: 'Un dossier de travail dédié, des responsabilités séparées, un exemple minimal.' },
  { front: 'Comment optimiser l’usage de %s ?', back: 'Mesurer d’abord, puis n’optimiser que le point réellement coûteux.' },
] as const;

/**
 * Jeu de flashcards mock conforme à courseFlashcardsSchema (min 10 cartes).
 * Déterministe par titre : mêmes cartes pour un même cours.
 */
export function mockCourseFlashcards(title: string): CourseFlashcards {
  const t = title.trim() || 'le cours';
  const cards = FLASHCARD_ANGLES.map((angle, i) => ({
    front: angle.front.replace(/%s/g, t),
    back: `${angle.back.replace(/%s/g, t)} (point clé n°${i + 1})`,
  }));
  return courseFlashcardsSchema.parse({ cards });
}

// ── Bande-annonce (Prompt 197) ──────────────────────────────────
/**
 * Script de bande-annonce mock : accroche → promesse → programme → CTA,
 * 120-1500 caractères (cf. trailerScriptSchema). Déterministe par titre.
 */
export function mockTrailerScript(title: string): { narration: string } {
  const t = title.trim() || 'ce cours';
  return {
    narration:
      `Vous bloquez sur ${t} et vous tournez en rond dans des tutoriels incomplets ? ` +
      `Ce cours vous emmène de la découverte à l'autonomie, sans jargon inutile. ` +
      `Vous installerez votre environnement, appliquerez ${t} sur des cas réels, ` +
      `et saurez diagnostiquer les erreurs les plus fréquentes. ` +
      `Au programme : des vidéos courtes, des articles de référence, des ateliers guidés et un quiz à chaque section. ` +
      `Inscrivez-vous maintenant : votre première manipulation se fait dans les dix prochaines minutes.`,
  };
}

// ── Quiz ────────────────────────────────────────────────────────
export const mockQuizSchema = z.array(quizQuestionSchema).min(1);

export function mockQuiz(title: string, count: number = QUIZ.MIN_QUESTIONS_PER_SECTION): QuizQuestion[] {
  const t = title.trim() || 'le cours';
  const questions: QuizQuestion[] = Array.from({ length: count }, (_, i) => {
    const correctIndex = hashString(`${t}:quiz:${i}`) % QUIZ.CHOICES_PER_QUESTION;
    const choices = Array.from({ length: QUIZ.CHOICES_PER_QUESTION }, (_, c) =>
      c === correctIndex
        ? `Réponse correcte : application juste de ${t} (cas ${i + 1})`
        : `Distracteur plausible ${c + 1} concernant ${t}`,
    );
    return {
      question: `Question ${i + 1} — dans le contexte de ${t}, quelle affirmation est exacte ?`,
      choices,
      correctIndex,
      explanation: `La bonne réponse illustre le point clé n°${i + 1} vu dans la section sur ${t}.`,
      difficulty: (['beginner', 'intermediate', 'advanced'] as const)[i % 3] ?? 'beginner',
    };
  });
  return mockQuizSchema.parse(questions);
}

// ── Texte alternatif (Prompt 137, accessibilité) ─────────────────
/**
 * Texte alternatif mock conforme à altTextResultSchema — déterministe par
 * le titre extrait du prompt (contient la légende + l'étape, cf.
 * buildAltTextPrompt côté @sallycourse/design/annotations).
 */
export function mockAltText(title: string): AltTextResult {
  const t = title.trim() || 'cette étape';
  return altTextResultSchema.parse({
    altText: `Capture d'écran illustrant ${t.toLowerCase()} dans l'interface du tutoriel.`,
  });
}

// ── Blog SEO (Prompt 204) ───────────────────────────────────────

/** Mot-clé cible lu dans le prompt d'article de blog (« Mot-clé cible : … »). */
export function extractBlogKeywordFromPrompt(user: string): string {
  const match = /mot-cl[ée]\s+cible\s*:\s*(.+)/i.exec(user);
  return match?.[1]?.trim() || extractTitleFromPrompt(user);
}

/** Nombre d'articles demandé dans le prompt de plan éditorial (« plan éditorial de N articles »). */
export function extractBlogPostCountFromPrompt(user: string): number {
  const match = /plan\s+[ée]ditorial\s+de\s+(\d+)\s+articles/i.exec(user);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24) : BLOG.DEFAULT_POSTS_PER_COURSE;
}

/** Gabarits d'angles SEO — un mot-clé long traîne distinct par article. */
const BLOG_ANGLES: readonly {
  titleTemplate: string;
  keywordTemplate: string;
  searchIntent: SearchIntent;
  angle: string;
}[] = [
  {
    titleTemplate: 'Débuter avec %s : le guide complet pour bien démarrer',
    keywordTemplate: 'débuter avec %s',
    searchIntent: 'informational',
    angle: 'Poser les bases et le vocabulaire pour un lecteur qui part de zéro.',
  },
  {
    titleTemplate: 'Les 7 erreurs les plus fréquentes en %s (et comment les éviter)',
    keywordTemplate: 'erreurs %s',
    searchIntent: 'informational',
    angle: 'Lister les pièges concrets rencontrés en production et leur correction.',
  },
  {
    titleTemplate: 'Combien de temps faut-il pour apprendre %s ?',
    keywordTemplate: 'apprendre %s',
    searchIntent: 'commercial',
    angle: "Cadrer un plan d'apprentissage réaliste selon le temps disponible.",
  },
  {
    titleTemplate: 'Quelle formation choisir pour %s ? Comparatif honnête',
    keywordTemplate: 'formation %s',
    searchIntent: 'commercial',
    angle: 'Comparer les formats de formation et donner des critères de choix.',
  },
  {
    titleTemplate: 'Se former à %s en 30 jours : le plan jour par jour',
    keywordTemplate: 'se former à %s',
    searchIntent: 'transactional',
    angle: 'Proposer un plan daté et actionnable pour passer à la pratique.',
  },
  {
    titleTemplate: 'Ressources et outils indispensables pour %s',
    keywordTemplate: 'outils %s',
    searchIntent: 'navigational',
    angle: 'Recenser les outils du quotidien et quand les utiliser.',
  },
];

/**
 * Plan éditorial mock (MOCK_PROVIDERS=true ou LLM en échec) : `count` articles
 * aux mots-clés distincts, déterministes par titre de cours.
 */
export function mockBlogPlan(courseTitle: string, count: number): BlogPlan {
  // Le thème est borné : un titre de cours très long ferait dépasser les bornes
  // de blogPlanSchema (title ≤ 120, keyword ≤ 80) — une fixture ne jette jamais.
  const t = (courseTitle.trim() || 'la thématique du cours').slice(0, 50).trim();
  const total = Math.max(1, Math.min(Math.trunc(count) || BLOG.DEFAULT_POSTS_PER_COURSE, 24));
  const posts = Array.from({ length: total }, (_unused, index) => {
    const angle = BLOG_ANGLES[index % BLOG_ANGLES.length]!;
    // Au-delà d'un tour de gabarits, un suffixe déterministe garde les mots-clés distincts.
    const cycle = Math.floor(index / BLOG_ANGLES.length);
    const suffix = cycle === 0 ? '' : ` (partie ${cycle + 1})`;
    return {
      title: (angle.titleTemplate.replace('%s', t) + suffix).slice(0, 120),
      keyword: (angle.keywordTemplate.replace('%s', t) + suffix).slice(0, 80),
      searchIntent: angle.searchIntent,
      angle: angle.angle,
    };
  });
  return blogPlanSchema.parse({ posts });
}

/**
 * Article de blog mock conforme aux règles SEO du générateur (BLOG.MIN_WORDS
 * mots, ≥ 4 sections H2, mot-clé dans le titre et répété dans le corps, FAQ) —
 * déterministe par (titre, mot-clé) extraits du prompt.
 */
export function mockBlogPost(title: string, keyword: string): BlogPostContent {
  const k = (keyword.trim() || 'le sujet traité').slice(0, 80).trim();
  const composed = title.trim().toLowerCase().includes(k.toLowerCase())
    ? title.trim()
    : `${title.trim() || 'Guide'} : tout savoir sur ${k}`;
  // Le titre DOIT contenir le mot-clé (règle SEO) : plutôt que de tronquer un
  // titre trop long (ce qui pourrait couper le mot-clé), on retombe sur un
  // gabarit court construit autour du mot-clé.
  const t = composed.length <= 120 ? composed : `${k} : le guide complet`;

  const skeleton = [
    `## ${k} : de quoi parle-t-on exactement ?`,
    `Avant d'aller plus loin, posons une définition claire de ${k}. Derrière l'expression se cachent des réalités très différentes selon les contextes, et c'est précisément cette confusion qui fait perdre le plus de temps aux débutants.`,
    '',
    '### Le vocabulaire à connaître',
    `Trois notions reviennent systématiquement dès que l'on aborde ${k} : le périmètre couvert, les outils employés et les critères de réussite. Les confondre conduit à des choix coûteux, difficiles à corriger plus tard.`,
    '',
    `## Pourquoi ${k} intéresse autant aujourd'hui`,
    `La demande explose parce que les organisations cherchent des résultats mesurables, rapidement. Maîtriser ${k} donne un avantage concret : vous savez quoi faire en premier, et surtout ce qu'il ne faut pas faire.`,
    '',
    '## La méthode en quatre étapes',
    "Commencez par un objectif écrit, mesurable, daté. Passez ensuite à un prototype minimal, mesurez, puis élargissez seulement ce qui a fonctionné. Cette boucle courte évite les mois perdus sur une piste sans issue.",
    '',
    '## Les erreurs qui coûtent le plus cher',
    `Vouloir tout industrialiser dès le premier jour reste l'erreur la plus répandue autour de ${k} : commencez petit, mesurez, puis élargissez ce qui a fait ses preuves.`,
  ].join('\n');

  const fillers = [
    `La première étape consiste à cartographier l'existant : ce qui fonctionne déjà, ce qui coince, et ce que vous mesurez réellement. Sans cette photographie initiale, impossible de démontrer le moindre progrès dans six mois.`,
    `Prenez le temps de documenter vos décisions au fil de l'eau. Une page suffit : le contexte, l'option retenue, les alternatives écartées. Ce réflexe vous fera gagner des heures lors des arbitrages suivants.`,
    `Testez chaque changement isolément. Modifier trois paramètres à la fois rend l'analyse impossible : vous saurez que le résultat a bougé, jamais pourquoi, et vous ne pourrez pas reproduire le succès.`,
    `Fixez-vous un rythme régulier plutôt qu'un sprint héroïque. Trente minutes par jour pendant un mois produisent des résultats bien supérieurs à deux week-ends intensifs suivis de six semaines d'oubli complet.`,
    `Entourez-vous : une communauté, un pair, un mentor. Expliquer votre raisonnement à voix haute révèle immédiatement les zones floues, celles que la lecture passive vous laissait croire acquises.`,
    `Enfin, mesurez ce qui compte pour vous, pas ce qui est facile à compter. Un indicateur pertinent et imparfait vaut mieux que trois métriques précises mais sans lien avec votre objectif réel.`,
  ] as const;

  const paragraphs: string[] = [];
  let markdown = skeleton;
  for (let i = 0; markdownWords(markdown) < BLOG.MIN_WORDS; i++) {
    paragraphs.push(fillers[i % fillers.length] ?? fillers[0]);
    markdown = `${skeleton}\n${paragraphs.join('\n\n')}`;
  }

  const metaDescription = `Tout ce qu'il faut savoir sur ${k} : définition, méthode en quatre étapes, erreurs fréquentes et réponses aux questions les plus posées.`.slice(
    0,
    BLOG.META_DESCRIPTION_MAX_CHARS,
  );

  return blogPostContentSchema.parse({
    title: t.slice(0, 120),
    metaDescription,
    markdown,
    faq: [
      {
        question: `Faut-il des prérequis pour se lancer dans ${k} ?`,
        answer: `Non : une bonne méthode et de la régularité suffisent pour démarrer. Les notions techniques s'acquièrent au fil des exercices, pas avant de commencer.`,
      },
      {
        question: `Combien de temps avant d'obtenir des résultats visibles ?`,
        answer: `Comptez quelques semaines de pratique régulière pour des résultats mesurables, à condition de travailler sur un cas concret plutôt que sur des exemples théoriques.`,
      },
      {
        question: `Quelle est l'erreur la plus coûteuse à éviter ?`,
        answer: `Vouloir tout automatiser ou tout optimiser dès le premier jour. Commencez par le cas le plus simple, validez-le, puis élargissez progressivement.`,
      },
    ],
  });
}

// ── Dispatch générique ──────────────────────────────────────────
/**
 * Retourne la fixture correspondant au schéma demandé : chaque candidat
 * (outline, quiz[], question, script vidéo, article, TP, marketing, blog) est validé
 * contre le schéma, le premier qui passe est retourné. Déterministe par titre.
 * Les fixtures blog sont en FIN de liste : leur forme (title + markdown) est
 * compatible avec articleContentSchema, elles ne doivent donc jamais passer
 * devant mockArticle pour les leçons de type article.
 */
export function mockFixtureFor<T>(schema: z.ZodType<T>, user: string): T {
  const title = extractTitleFromPrompt(user);
  const candidates: unknown[] = [
    mockOutline(title),
    mockQuiz(title),
    mockQuiz(title, 1)[0],
    mockVideoScript(title),
    mockSlideScript(title, extractDurationMinFromPrompt(user)),
    mockArticle(title),
    mockTp(title),
    mockMarketing(title),
    mockCourseResources(title),
    mockCourseFlashcards(title),
    mockTrailerScript(title),
    mockAltText(title),
    mockBlogPlan(title, extractBlogPostCountFromPrompt(user)),
    mockBlogPost(title, extractBlogKeywordFromPrompt(user)),
  ];
  for (const candidate of candidates) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  throw new Error(
    'mock-fixtures : aucun fixture ne correspond au schéma demandé — ' +
      'ajouter un générateur dédié dans src/lib/mock-fixtures.ts',
  );
}
