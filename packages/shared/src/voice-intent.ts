// Création de cours à la VOIX + intentions de l'assistant (Prompt 210) — module
// PUR (aucun I/O, aucune dépendance runtime lourde) : schémas Zod, prompts
// Darija-aware et heuristique de repli déterministe. Testable unitairement.
//
// Deux responsabilités indépendantes :
//  1. DICTÉE : transformer une transcription vocale (français / arabe / darija,
//     imparfaitement transcrite par faster-whisper) en un « brief » structuré
//     (dictationBriefSchema) puis en createCourseInput (toCreateCourseInput).
//  2. ASSISTANT : décrire l'intention résolue par l'assistant du dashboard sous
//     forme d'action typée (assistantActionSchema) alignée sur les routes MÉTIER
//     existantes. Ce module ne fait que MODÉLISER l'action — jamais l'exécuter.
import { z } from 'zod';
// prettier-ignore
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { difficultySchema, localeSchema, createCourseInputSchema, type CreateCourseInput } from './schemas/course';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import type { Locale } from './constants';

// ── Langue d'ENTRÉE de la dictée ────────────────────────────────
// La darija est une langue d'ENTRÉE uniquement (jamais une locale de cours) :
// faster-whisper n'a pas de modèle « darija », on la transcrit donc en arabe
// ('ar') puis le LLM rattrape à l'étape compréhension. LOCALES reste fr|en|ar.
export const DICTATION_INPUT_LANGS = ['darija', 'ar', 'fr'] as const;
export type DictationInputLang = (typeof DICTATION_INPUT_LANGS)[number];
export const dictationInputLangSchema = z.enum(DICTATION_INPUT_LANGS);

/** Code langue faster-whisper (ISO 639-1) pour une langue d'entrée — darija → arabe. */
export function whisperLangForDictation(lang: DictationInputLang): string {
  return lang === 'fr' ? 'fr' : 'ar';
}

// ── Brief dicté (sortie de l'étape COMPRÉHENSION) ───────────────
/**
 * Brief structuré extrait de la transcription : cible de la dictée, il
 * pré-remplit le formulaire de création (deriveInitialBrief). `understood` et
 * `confidence` servent l'affichage de contrôle AVANT toute action.
 */
export const dictationBriefSchema = z.object({
  /** Titre du cours déduit de la dictée. */
  title: z.string().trim().min(3).max(120),
  /** Niveau visé (défaut débutant si non exprimé). */
  difficulty: difficultySchema.default('beginner'),
  /** Locale de SORTIE du cours (fr|en|ar) — jamais « darija ». */
  locale: localeSchema.default('fr'),
  /** Nombre de sections souhaité, si l'auteur l'a exprimé. */
  approxSections: z.number().int().min(3).max(30).optional(),
  /** Public visé exprimé oralement (« pour les débutants », « pour des devs »…). */
  audience: z.string().trim().max(300).optional(),
  /** Reformulation en clair de ce qui a été compris (montrée avant confirmation). */
  understood: z.string().trim().max(600).optional(),
  /** Confiance 0-1 de la compréhension (basse si darija ambiguë). */
  confidence: z.number().min(0).max(1).default(0.5),
});
export type DictationBrief = z.infer<typeof dictationBriefSchema>;

/**
 * Convertit un brief dicté en createCourseInput valide (cible du formulaire).
 * Le public visé alimente advancedParams.audience (Phase 10). Ne fixe aucun
 * autre paramètre avancé : la dictée reste une entrée MINIMALE, l'auteur
 * complète ensuite dans l'UI. Lève si le brief est incohérent (title trop court).
 */
export function toCreateCourseInput(brief: DictationBrief): CreateCourseInput {
  return createCourseInputSchema.parse({
    title: brief.title,
    difficulty: brief.difficulty,
    locale: brief.locale,
    ...(brief.approxSections ? { approxSections: brief.approxSections } : {}),
    ...(brief.audience ? { advancedParams: { audience: brief.audience } } : {}),
  });
}

// ── Prompts Darija-aware (compréhension par le LLM) ─────────────
const LOCALE_LABELS: Record<Locale, string> = { fr: 'français', en: 'anglais', ar: 'arabe' };

/**
 * Prompt système de l'étape compréhension : le LLM reçoit une transcription
 * VOCALE potentiellement imparfaite (surtout en darija, souvent translittérée
 * en lettres latines ou mal orthographiée) et doit en extraire un brief JSON.
 * Few-shot darija inclus — c'est ici que la darija « se rattrape ».
 */
export function dictationSystemPrompt(): string {
  return [
    `Tu analyses une transcription VOCALE d'un créateur de cours en ligne. Il décrit,`,
    `à l'oral, le cours qu'il veut générer. La transcription vient d'un moteur de`,
    `reconnaissance vocale et peut être IMPARFAITE — surtout en arabe dialectal`,
    `marocain (darija), parfois écrit en lettres latines (« 3 » = ع/ح, « 7 » = ح,`,
    `« 9 » = ق) ou mal orthographié. Reconstitue l'INTENTION réelle.`,
    ``,
    `Extrais un brief structuré :`,
    `- title : le SUJET du cours, formulé comme un titre clair (jamais la phrase brute).`,
    `- difficulty : "beginner" | "intermediate" | "advanced" (défaut "beginner" si non dit).`,
    `- locale : langue de PRODUCTION du cours "fr" | "en" | "ar" (défaut "fr").`,
    `  La darija n'est PAS une locale : un cours dicté en darija se produit en "fr" ou "ar".`,
    `- approxSections : nombre de sections si mentionné (entier 3-30), sinon omets.`,
    `- audience : public visé si exprimé (« pour les débutants », « pour des devs »…).`,
    `- understood : une phrase résumant ce que tu as compris (dans la locale du cours).`,
    `- confidence : 0 à 1, ta confiance dans l'extraction (baisse si la dictée est ambiguë).`,
    ``,
    `EXEMPLES (darija translittérée → brief) :`,
    `- « bghit ndir cours 3la Docker l les débutants »`,
    `  → { "title": "Docker pour les débutants", "difficulty": "beginner", "locale": "fr",`,
    `      "audience": "débutants", "understood": "Cours d'introduction à Docker en français", "confidence": 0.8 }`,
    `- « 3tini formation 3la l'intelligence artificielle b darija, mustawa mutawassit »`,
    `  → { "title": "الذكاء الاصطناعي", "difficulty": "intermediate", "locale": "ar",`,
    `      "understood": "دورة عن الذكاء الاصطناعي بمستوى متوسط", "confidence": 0.7 }`,
    `- « I want an advanced course about Kubernetes networking »`,
    `  → { "title": "Advanced Kubernetes Networking", "difficulty": "advanced", "locale": "en", "confidence": 0.9 }`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec ce JSON (aucun texte autour, aucune fence) :`,
    `{ "title": string, "difficulty": string, "locale": string, "approxSections"?: number,`,
    `  "audience"?: string, "understood"?: string, "confidence": number }`,
  ].join('\n');
}

/** Prompt utilisateur : la transcription brute + la langue d'entrée déclarée. */
export function dictationUserPrompt(transcript: string, inputLang: DictationInputLang): string {
  const langLabel =
    inputLang === 'fr' ? 'français' : inputLang === 'ar' ? 'arabe standard' : 'darija (arabe marocain)';
  return [
    `Langue déclarée de la dictée : ${langLabel}.`,
    `Transcription vocale (peut contenir des erreurs de reconnaissance) :`,
    ``,
    `« ${transcript.trim()} »`,
  ].join('\n');
}

// ── Repli déterministe (MOCK / aucun provider) ──────────────────
const _BEGINNER_HINTS = ['debutant', 'débutant', 'debutants', 'beginner', 'basic', 'mbtdi', 'mubtadi', 'مبتدئ', 'lmabda2', 'zero'];
const INTERMEDIATE_HINTS = ['intermediaire', 'intermédiaire', 'intermediate', 'moyen', 'mutawassit', 'متوسط'];
const ADVANCED_HINTS = ['avance', 'avancé', 'avancés', 'advanced', 'expert', 'mut2adim', 'متقدم', 'pro'];

/** Marqueurs « sur X » dans les trois langues d'entrée (darija translittérée incluse). */
const TOPIC_MARKERS = [' sur ', ' about ', ' 3la ', ' 3ala ', ' 7awl ', ' 7awla ', ' 3an ', ' de ', ' على ', ' حول ', ' عن '];

/** Retire les amorces courantes (« je veux un cours », « bghit ndir cours »…). */
function stripDictationPreamble(text: string): string {
  return text
    .replace(
      /^\s*(je\s+veux|j'?aimerais|i\s+want|i'?d\s+like|bghit|bgha|3tini|3tiny|3teeni|dir|ndir|sawb|nsawb|make\s+me|create|génère|genere|generate)\s+/i,
      '',
    )
    .replace(/^\s*(un|une|a|an|wa7d|wahed|chi)\s+/i, '')
    .replace(/^\s*(cours|formation|course|training|dawra|dora)\s+/i, '')
    .trim();
}

/** Coupe un titre candidat sur une frontière de mot, borné à `max` caractères. */
function clampTitle(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

function difficultyFromText(lower: string): DictationBrief['difficulty'] {
  if (ADVANCED_HINTS.some((h) => lower.includes(h))) return 'advanced';
  if (INTERMEDIATE_HINTS.some((h) => lower.includes(h))) return 'intermediate';
  return 'beginner';
}

/**
 * Compréhension de REPLI (MOCK_PROVIDERS actif ou aucun provider LLM) :
 * heuristique PURE et déterministe. Le texte reste EXACT — seule
 * l'interprétation est approximative (confiance basse, honnête). Extrait le
 * sujet après un marqueur « sur/3la/about… », sinon prend le début de la dictée.
 */
export function mockBriefFromTranscript(
  transcript: string,
  inputLang: DictationInputLang,
): DictationBrief {
  const raw = transcript.trim();
  const lower = raw.toLowerCase();

  // Sujet : après le premier marqueur « sur X », sinon la dictée sans amorce.
  let topic = '';
  for (const marker of TOPIC_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      topic = raw.slice(idx + marker.length).trim();
      break;
    }
  }
  if (topic.length < 2) topic = stripDictationPreamble(raw);
  // Retire une éventuelle mention de niveau/public en fin de sujet (garde le cœur).
  topic = topic.replace(/\b(pour|l\s|li|l les|for|b\s?darija|en\s+darija)\b.*$/i, '').trim();

  const title = clampTitle(topic || raw);
  // Locale de SORTIE : jamais « darija ». Une dictée en darija produit du fr par
  // défaut ; une dictée en arabe standard produit de l'arabe.
  const locale: Locale = inputLang === 'ar' ? 'ar' : 'fr';
  const difficulty = difficultyFromText(lower);

  // Public visé : segment après « pour / for / li ».
  const audienceMatch = /\b(?:pour|for|l les|li)\s+([^.,;]{3,60})/i.exec(raw);
  const audience = audienceMatch?.[1]?.trim();

  // Confiance : la darija translittérée est la plus risquée.
  const confidence = inputLang === 'darija' ? 0.4 : inputLang === 'ar' ? 0.5 : 0.6;

  return dictationBriefSchema.parse({
    // Garantit le plancher min(3) : titres trop courts → repli lisible.
    title: title.length >= 3 ? title : 'Nouveau cours',
    difficulty,
    locale,
    ...(audience ? { audience } : {}),
    understood: `Cours sur « ${title.length >= 3 ? title : 'sujet à préciser'} » en ${LOCALE_LABELS[locale]} (niveau ${difficulty}).`,
    confidence,
  });
}

// ── Actions de l'assistant du dashboard ─────────────────────────
// Union discriminée alignée sur les routes MÉTIER existantes. L'assistant
// RÉSOUT une intention → propose l'action ; l'exécution passe TOUJOURS par la
// route correspondante (ownership/quota/audit déjà en place). Jamais d'exécution
// implicite (chaque action coûte du quota, de l'argent LLM, ou publie en externe).
export const assistantActionSchema = z.discriminatedUnion('type', [
  /** Créer un cours → POST /api/courses. */
  z.object({ type: z.literal('create_course'), input: createCourseInputSchema }),
  /** Valider et continuer la génération (mode validé) → POST /api/courses/[id]/continue-generation. */
  z.object({ type: z.literal('continue_generation'), courseId: z.string().min(1) }),
  /** Régénérer le plan → POST /api/courses/[id]/regenerate-outline. */
  z.object({
    type: z.literal('regenerate_outline'),
    courseId: z.string().min(1),
    extraInstructions: z.string().trim().max(1000).optional(),
  }),
  /** Régénérer une leçon → POST /api/lessons/[id]/regenerate. */
  z.object({
    type: z.literal('regenerate_lesson'),
    courseId: z.string().min(1),
    lessonId: z.string().min(1),
    instruction: z.string().trim().max(1000).optional(),
  }),
  /** Déployer → POST /api/courses/[id]/deploy. */
  z.object({
    type: z.literal('deploy_course'),
    courseId: z.string().min(1),
    platform: z.string().trim().min(1).optional(),
  }),
  /** Aucune action résolue (question hors périmètre / intention ambiguë). */
  z.object({ type: z.literal('none'), reason: z.string().trim().max(400) }),
]);
export type AssistantAction = z.infer<typeof assistantActionSchema>;

/** Types d'action mutants (exigent une confirmation explicite avant exécution). */
export const MUTATING_ASSISTANT_ACTIONS = [
  'create_course',
  'continue_generation',
  'regenerate_outline',
  'regenerate_lesson',
  'deploy_course',
] as const;

/** Vrai si l'action déclenche un effet de bord coûteux (⇒ confirmation requise). */
export function assistantActionRequiresConfirmation(action: AssistantAction): boolean {
  // Cast `as string` : sous la résolution NodeNext du worker, l'inférence de la
  // discriminated union (createCourseInputSchema imbriqué) élargit action.type ;
  // le cast neutralise ce différentiel de typage, sans effet à l'exécution.
  return (MUTATING_ASSISTANT_ACTIONS as readonly string[]).includes(action.type as string);
}
