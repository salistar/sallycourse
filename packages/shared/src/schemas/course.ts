import { z } from 'zod';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { LOCALES } from '../constants';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { VOICE_CATALOG_IDS } from '../voice-catalog';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { THEME_CATALOG_IDS } from '../theme-catalog';

// Source de vérité unique des entités (Prompt 114) — les types TS et la
// validation API dérivent de ces schémas ; les modèles Mongoose les suivent.

export const difficultySchema = z.enum(['beginner', 'intermediate', 'advanced']);
export type Difficulty = z.infer<typeof difficultySchema>;

export const courseStatusSchema = z.enum([
  'draft',
  'generating',
  'outline-review',
  'ready',
  'published',
  'failed',
  // Annulation propre demandée par l'utilisateur en cours de génération (P73).
  'cancelled',
]);
export type CourseStatus = z.infer<typeof courseStatusSchema>;

export const lessonTypeSchema = z.enum(['video', 'article', 'tp', 'quiz']);
export type LessonType = z.infer<typeof lessonTypeSchema>;

export const localeSchema = z.enum(LOCALES);

export const outlineLessonSchema = z.object({
  title: z.string().min(1),
  type: lessonTypeSchema,
  durationMin: z.number().positive(),
  summary: z.string(),
});

export const outlineSectionSchema = z.object({
  title: z.string().min(1),
  lessons: z.array(outlineLessonSchema).min(1),
});

export const outlineSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string(),
  description: z.string(),
  learningObjectives: z.array(z.string()).min(4).max(8),
  prerequisites: z.array(z.string()),
  targetAudience: z.array(z.string()),
  sections: z.array(outlineSectionSchema).min(1),
});
export type Outline = z.infer<typeof outlineSchema>;

export const quizQuestionSchema = z.object({
  question: z.string().min(1),
  choices: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  difficulty: difficultySchema.default('beginner'),
});
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

/**
 * Mode d'enchaînement de la génération du contenu :
 * - 'auto'      : chaque leçon terminée enfile automatiquement la suivante
 *                 (chaînage séquentiel P19, comportement historique) ;
 * - 'validated' : la chaîne S'ARRÊTE après chaque leçon générée — l'auteur
 *                 relit (script/article/quiz/TP) puis clique « Valider et
 *                 continuer » pour lancer la génération de la suivante.
 */
export const generationModeSchema = z.enum(['auto', 'validated']);
export type GenerationMode = z.infer<typeof generationModeSchema>;

// ── Phase 10 — Paramètres de génération avancés (Prompts 163-174) ────────────
//
// L'entrée reste minimale (titre + niveau) ; ces paramètres OPTIONNELS donnent
// le contrôle total quand l'auteur ouvre le panneau « Personnaliser ». Tous ont
// une valeur par défaut intelligente et sont injectés dans les prompts de
// génération (plan/scripts/articles) — voir generation-params.ts (helpers de
// rendu texte des directives) côté worker.

/** Ton pédagogique (P165). */
export const toneSchema = z.enum(['academic', 'conversational', 'energetic']);
/** Densité du contenu (P165). */
export const densitySchema = z.enum(['concise', 'normal', 'detailed']);
/** Approche pédagogique (P165). */
export const approachSchema = z.enum(['theory-first', 'examples-first', 'practice-first']);
/** Objectif de l'apprenant (P165) — oriente les TPs et le ton. */
export const learnerObjectiveSchema = z.enum(['certification', 'career-change', 'upskilling']);
/** Position des quiz dans le cours (P164). */
export const quizPositionSchema = z.enum(['per-section', 'mid-course', 'final-only']);
export type QuizPosition = z.infer<typeof quizPositionSchema>;
/** Durée moyenne cible d'une vidéo (P164). */
export const avgVideoLengthSchema = z.enum(['3-5', '5-8', '8-12']);
/** Nature du/des TP(s) (P164) : projet fil rouge évolutif vs TPs indépendants. */
export const projectModeSchema = z.enum(['fil-rouge', 'independent']);
/** OS ciblé pour les TPs (P166). */
export const tpOsSchema = z.enum(['windows', 'linux', 'macos', 'web', 'any']);

/** Ratio (poids relatifs 0-100) des types de contenu (P164) — normalisé à la génération. */
export const contentRatioSchema = z.object({
  video: z.number().min(0).max(100).default(40),
  article: z.number().min(0).max(100).default(25),
  tp: z.number().min(0).max(100).default(20),
  quiz: z.number().min(0).max(100).default(15),
});
export type ContentRatio = z.infer<typeof contentRatioSchema>;

/** Points d'arrêt de validation configurables (P170), affinent generationMode='validated'. */
export const validationPointsSchema = z.object({
  afterPlan: z.boolean().default(true),
  afterScripts: z.boolean().default(false),
  afterDraft: z.boolean().default(false),
});
export type ValidationPoints = z.infer<typeof validationPointsSchema>;

/**
 * Paramètres avancés de génération (P163-174). Objet unique, entièrement
 * optionnel (chaque champ a un défaut) — un cours créé en mode simple n'en
 * fournit aucun et se comporte comme avant.
 */
export const advancedParamsSchema = z.object({
  // Structure (P164)
  targetHours: z.number().min(0.5).max(20).optional(),
  avgVideoLength: avgVideoLengthSchema.optional(),
  contentRatio: contentRatioSchema.optional(),
  quizPosition: quizPositionSchema.optional(),
  finalExam: z.boolean().optional(),
  finalExamPassingScore: z.number().int().min(50).max(100).optional(),
  projectMode: projectModeSchema.optional(),
  // Pédagogie (P165)
  tone: toneSchema.optional(),
  density: densitySchema.optional(),
  approach: approachSchema.optional(),
  analogies: z.boolean().optional(),
  spacedRepetition: z.boolean().optional(),
  audience: z.string().max(300).optional(),
  objective: learnerObjectiveSchema.optional(),
  // Domaine expert (P166)
  mandatoryKeywords: z.array(z.string().min(1)).max(40).optional(),
  excludedTopics: z.array(z.string().min(1)).max(40).optional(),
  imposedTools: z.string().max(300).optional(),
  tpOs: tpOsSchema.optional(),
  codeCommentLang: z.string().max(40).optional(),
  glossary: z.string().max(2000).optional(),
  // Voix & vidéo (P167) — complète ttsVoice/avatar déjà au niveau racine
  narrationSpeed: z.number().min(0.75).max(1.25).optional(),
  generateVertical: z.boolean().optional(),
  slideLanguage: localeSchema.optional(),
  // Mode certification (P168)
  certificationTarget: z.string().max(80).optional(),
  // Multi-voix dialogue (P169)
  dialogueMode: z.boolean().optional(),
  dialogueSecondVoice: z.string().optional(),
  // Points de validation (P170)
  validationPoints: validationPointsSchema.optional(),
});
export type AdvancedParams = z.infer<typeof advancedParamsSchema>;

export const createCourseInputSchema = z.object({
  title: z.string().min(3).max(120),
  difficulty: difficultySchema,
  locale: localeSchema.default('fr'),
  /** Mode d'enchaînement (voir generationModeSchema) — absent = automatique. */
  generationMode: generationModeSchema.optional(),
  /**
   * Provider LLM choisi pour la rédaction du cours — id du catalogue cloud
   * ('gemini', 'deepseek', 'xai'…), 'anthropic', ou 'ollama' (OSS local).
   * Absent → cascade coût par défaut (cloud gratuit → Anthropic → Ollama).
   */
  llmProvider: z.string().min(1).optional(),
  ttsVoice: z.string().optional(),
  /**
   * Moteur de voix premium préféré (audit qualité modèles 2026-07-22, additif) —
   * voir doc dans packages/db Course.ttsEngine. Absent = 'chatterbox' (défaut
   * historique, comportement inchangé pour tous les cours existants).
   */
  ttsEngine: z.enum(['chatterbox', 'qwen3']).optional(),
  /**
   * Voix de narration du catalogue (fix « voix multiples » 2026-07-26) — id de
   * VOICE_CATALOG. Absent = voix par défaut de la langue du cours. Voir doc
   * dans packages/db Course.voiceId.
   */
  voiceId: z.enum(VOICE_CATALOG_IDS).optional(),
  /**
   * Thème visuel des slides et articles (catalogue 2026-07-26) — id de
   * THEME_CATALOG. Absent = « salistar » (défaut historique, rendu inchangé).
   */
  themeId: z.enum(THEME_CATALOG_IDS).optional(),
  /**
   * Moteur d'image premium préféré (audit qualité modèles 2026-07-22, additif) —
   * voir doc dans packages/db Course.imageEngine. Absent = 'sdxl' (défaut
   * historique, comportement inchangé pour tous les cours existants).
   */
  imageEngine: z.enum(['sdxl', 'zimage']).optional(),
  targetPlatforms: z.array(z.string()).default([]),
  approxSections: z.number().int().min(3).max(30).optional(),
  /**
   * Avatar vidéo (P82, bêta) — additif. Optionnel côté type (comme ttsVoice/
   * approxSections) pour ne pas casser les appelants existants de
   * createCourseForUser qui ne le renseignent pas encore ; createCourseForUser
   * traite absent/false de façon identique (comportement inchangé par défaut).
   */
  avatarEnabled: z.boolean().optional(),
  /** Avatar HeyGen choisi — ignoré si avatarEnabled=false. */
  avatarId: z.string().optional(),
  /**
   * Voix clonée personnalisée (Chatterbox/Modal) — additif. Si vrai ET que le
   * propriétaire a un échantillon vocal prêt, la narration utilise sa voix
   * clonée. Optionnel, défaut false (voix standard).
   */
  useCustomVoice: z.boolean().optional(),
  /**
   * Programmer la génération en heures creuses (P134) — si vrai, le premier
   * job (outline) est enfilé avec un délai BullMQ jusqu'à la prochaine
   * fenêtre creuse (2h-6h, voir off-peak-window.ts) au lieu de démarrer
   * immédiatement. Optionnel, défaut false (comportement inchangé).
   */
  scheduleOffPeak: z.boolean().optional(),
  /**
   * Paramètres de génération avancés (Phase 10) — optionnels, injectés dans les
   * prompts de plan/scripts/articles. Absent = comportement simple par défaut.
   */
  advancedParams: advancedParamsSchema.optional(),
});
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>;
