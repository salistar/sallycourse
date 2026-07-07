import { z } from 'zod';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { difficultySchema, localeSchema } from './schemas/course';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { lessonTypeSchema, type LessonType } from './schemas/course';

// Bibliothèque de templates de niche (Prompt 58).
// Chaque template pré-configure la structure et les paramètres de génération
// d'un cours : nombre de sections, répartition des types de leçons, ton, niveau,
// langue, exemples de titres qui « marchent ». Le formulaire /dashboard/new peut
// hydrater ses champs depuis un template (?template=<id>).

/** Ton éditorial suggéré à l'IA de rédaction. */
export const courseToneSchema = z.enum([
  'professional', // sobre, orienté métier
  'friendly', // chaleureux, accessible
  'energetic', // dynamique, motivant
  'academic', // rigoureux, structuré
  'conversational', // proche, tutoiement
]);
export type CourseTone = z.infer<typeof courseToneSchema>;

/** Catégories de niche pour regrouper les templates dans l'UI. */
export const templateCategorySchema = z.enum([
  'devops',
  'office', // bureautique
  'languages', // langues
  'business',
]);
export type TemplateCategory = z.infer<typeof templateCategorySchema>;

/**
 * Ratio des types de leçons — pondérations relatives (pas des pourcentages ;
 * elles sont normalisées à l'usage). Au moins un type doit être > 0.
 */
export const lessonMixSchema = z
  .object({
    video: z.number().min(0).default(0),
    article: z.number().min(0).default(0),
    tp: z.number().min(0).default(0),
    quiz: z.number().min(0).default(0),
  })
  .refine((mix) => mix.video + mix.article + mix.tp + mix.quiz > 0, {
    message: 'Le ratio de types de leçons doit contenir au moins un type non nul.',
  });
export type LessonMix = z.infer<typeof lessonMixSchema>;

/**
 * Schéma d'un template. Les bornes de `sections` reflètent
 * createCourseInputSchema (approxSections : 3–30) pour qu'un template soit
 * toujours instanciable sans clamp.
 */
export const courseTemplateSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/u, 'id en kebab-case (a-z, 0-9, tirets).'),
  category: templateCategorySchema,
  /** Emoji d'illustration (léger, aucun asset externe). */
  emoji: z.string().min(1).max(8),
  /** Libellé court affiché sur la carte. */
  name: z.string().min(3).max(60),
  /** Accroche d'une ligne. */
  tagline: z.string().min(8).max(160),
  /** Description longue (bénéfice + à qui s'adresse le cours). */
  description: z.string().min(20).max(600),
  /** Niveau par défaut du cours généré. */
  difficulty: difficultySchema,
  /** Langue par défaut. */
  locale: localeSchema,
  /** Ton éditorial suggéré. */
  tone: courseToneSchema,
  /** Nombre de sections visé — dans les bornes de createCourseInputSchema. */
  sections: z.number().int().min(3).max(30),
  /** Répartition des types de leçons. */
  lessonMix: lessonMixSchema,
  /** Exemples de titres « qui marchent » — pré-remplissent le champ titre. */
  exampleTitles: z.array(z.string().min(3).max(120)).min(2).max(6),
  /** Sujets d'appel affichés en puces (structure indicative). */
  suggestedTopics: z.array(z.string().min(2).max(80)).min(3).max(10),
});
export type CourseTemplate = z.infer<typeof courseTemplateSchema>;

/**
 * Instancie les valeurs de formulaire /dashboard/new à partir d'un template.
 * Ne renvoie QUE des champs compatibles createCourseInputSchema (title,
 * difficulty, locale, approxSections) — le titre est le 1er exemple.
 */
export function templateToCourseDraft(template: CourseTemplate): {
  title: string;
  difficulty: CourseTemplate['difficulty'];
  locale: CourseTemplate['locale'];
  approxSections: number;
} {
  return {
    // exampleTitles a un min(2) au schéma : le premier élément existe toujours.
    title: template.exampleTitles[0] ?? template.name,
    difficulty: template.difficulty,
    locale: template.locale,
    approxSections: template.sections,
  };
}

/**
 * Normalise le lessonMix en pourcentages entiers (somme = 100), utile pour
 * l'affichage et pour piloter la génération. Les arrondis sont réconciliés
 * sur le type dominant afin que la somme fasse exactement 100.
 */
export function lessonMixPercentages(mix: LessonMix): Record<LessonType, number> {
  const types: LessonType[] = ['video', 'article', 'tp', 'quiz'];
  const total = types.reduce((sum, t) => sum + mix[t], 0);
  if (total <= 0) return { video: 0, article: 0, tp: 0, quiz: 0 };

  const raw = types.map((t) => ({ type: t, pct: (mix[t] / total) * 100 }));
  const floored = raw.map((r) => ({ ...r, floor: Math.floor(r.pct) }));
  let remainder = 100 - floored.reduce((sum, r) => sum + r.floor, 0);

  // Distribue le reste aux plus grandes parties fractionnaires.
  const byFraction = [...floored].sort(
    (a, b) => b.pct - b.floor - (a.pct - a.floor),
  );
  const result: Record<LessonType, number> = { video: 0, article: 0, tp: 0, quiz: 0 };
  for (const r of floored) result[r.type] = r.floor;
  for (const r of byFraction) {
    if (remainder <= 0) break;
    result[r.type] += 1;
    remainder -= 1;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Bibliothèque de templates                                           */
/* ------------------------------------------------------------------ */

export const COURSE_TEMPLATES: readonly CourseTemplate[] = [
  {
    id: 'devops-ci-cd',
    category: 'devops',
    emoji: '🚀',
    name: 'DevOps & CI/CD',
    tagline: 'Du commit à la production, sans friction.',
    description:
      'Un parcours pratique pour automatiser build, tests et déploiement : ' +
      'pipelines, conteneurs et infrastructure as code. Idéal pour développeurs ' +
      'qui veulent livrer plus vite et plus sûrement.',
    difficulty: 'intermediate',
    locale: 'fr',
    tone: 'professional',
    sections: 8,
    lessonMix: { video: 5, article: 2, tp: 4, quiz: 1 },
    exampleTitles: [
      'DevOps de zéro : Docker, CI/CD et déploiement automatisé',
      'Maîtriser les pipelines GitLab CI en pratique',
      'Kubernetes pour développeurs : de la théorie à la prod',
      'Infrastructure as Code avec Terraform, pas à pas',
    ],
    suggestedTopics: [
      'Conteneurisation avec Docker',
      'Pipelines CI/CD',
      'Orchestration Kubernetes',
      'Infrastructure as Code',
      'Monitoring et observabilité',
      'Sécurité de la chaîne de livraison',
    ],
  },
  {
    id: 'office-excel',
    category: 'office',
    emoji: '📊',
    name: 'Bureautique & Excel',
    tagline: 'Devenez la personne qui maîtrise vraiment Excel.',
    description:
      'Formules, tableaux croisés, graphiques et automatisation : gagnez des ' +
      'heures chaque semaine. Pensé pour un public non technique qui veut des ' +
      'résultats concrets dès la première leçon.',
    difficulty: 'beginner',
    locale: 'fr',
    tone: 'friendly',
    sections: 6,
    lessonMix: { video: 6, article: 3, tp: 3, quiz: 2 },
    exampleTitles: [
      'Excel de A à Z : du débutant à l’expert',
      'Maîtriser les tableaux croisés dynamiques en 2 heures',
      'Automatiser vos rapports Excel sans code',
      'Excel pour le travail : formules et astuces indispensables',
    ],
    suggestedTopics: [
      'Formules essentielles',
      'Tableaux croisés dynamiques',
      'Graphiques et visualisation',
      'Mise en forme conditionnelle',
      'Fonctions de recherche (RECHERCHEX)',
      'Automatisation et macros',
    ],
  },
  {
    id: 'languages-spoken',
    category: 'languages',
    emoji: '🗣️',
    name: 'Langues & Expression orale',
    tagline: 'Parler avec confiance, dès les premières leçons.',
    description:
      'Une méthode orientée conversation : vocabulaire utile, prononciation et ' +
      'mises en situation réelles. Beaucoup de pratique guidée pour ancrer les ' +
      'automatismes et parler sans hésiter.',
    difficulty: 'beginner',
    locale: 'fr',
    tone: 'conversational',
    sections: 10,
    lessonMix: { video: 6, article: 2, tp: 5, quiz: 3 },
    exampleTitles: [
      'Anglais conversationnel : parlez dès la première semaine',
      'Espagnol pour voyager : l’essentiel en 30 jours',
      'Prononciation anglaise : perdez votre accent',
      'Anglais professionnel : réunions, e-mails et présentations',
    ],
    suggestedTopics: [
      'Vocabulaire du quotidien',
      'Prononciation et phonétique',
      'Dialogues et mises en situation',
      'Grammaire par la pratique',
      'Compréhension orale',
      'Expressions idiomatiques',
    ],
  },
  {
    id: 'business-freelance',
    category: 'business',
    emoji: '💼',
    name: 'Business & Freelance',
    tagline: 'Lancez votre activité et trouvez vos premiers clients.',
    description:
      'De l’idée aux premiers revenus : positionnement, offre, prospection et ' +
      'gestion. Un cours actionnable pour indépendants et créateurs qui veulent ' +
      'construire une activité rentable.',
    difficulty: 'intermediate',
    locale: 'fr',
    tone: 'energetic',
    sections: 7,
    lessonMix: { video: 5, article: 4, tp: 3, quiz: 1 },
    exampleTitles: [
      'Devenir freelance : le guide complet pour se lancer',
      'Trouver ses premiers clients sans réseau',
      'Fixer ses tarifs et vendre ses services avec confiance',
      'Le business plan simple pour créateurs indépendants',
    ],
    suggestedTopics: [
      'Trouver son positionnement',
      'Construire une offre irrésistible',
      'Prospection et acquisition',
      'Fixer ses prix',
      'Gérer sa comptabilité',
      'Fidéliser ses clients',
    ],
  },
] as const;

/** Table indexée par id pour un accès O(1). */
const TEMPLATES_BY_ID: ReadonlyMap<string, CourseTemplate> = new Map(
  COURSE_TEMPLATES.map((t) => [t.id, t]),
);

/** Retourne un template par son id, ou undefined si inconnu. */
export function getCourseTemplate(id: string): CourseTemplate | undefined {
  return TEMPLATES_BY_ID.get(id);
}

/** Templates d'une catégorie donnée. */
export function templatesByCategory(category: TemplateCategory): CourseTemplate[] {
  return COURSE_TEMPLATES.filter((t) => t.category === category);
}

/** Libellés français des catégories (UI). */
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  devops: 'DevOps & Cloud',
  office: 'Bureautique',
  languages: 'Langues',
  business: 'Business',
};

/** Libellés français des tons (UI). */
export const COURSE_TONE_LABELS: Record<CourseTone, string> = {
  professional: 'Professionnel',
  friendly: 'Accessible',
  energetic: 'Dynamique',
  academic: 'Rigoureux',
  conversational: 'Conversationnel',
};

// Garde-fou : les types de lessonMix couvrent exactement lessonTypeSchema.
// (Vérifié aussi par les tests ; ici on force l'usage de l'import.)
export const LESSON_MIX_TYPES = lessonTypeSchema.options;
