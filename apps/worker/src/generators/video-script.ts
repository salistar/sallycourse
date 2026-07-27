// Générateur de scripts vidéo (Prompt 15) : pour une leçon de type 'video',
// appelle Claude avec slideScriptSchema, applique les validations métier
// (templates title/recap, débit de narration, formules interdites) avec retry
// + feedback, puis persiste Lesson.script + status.
import {
  AUDIO,
  Course,
  Lesson,
  renderGenerationDirectives,
  slideScriptSchema,
  type SlideScript,
} from '../shared.js';
import { z } from 'zod';
import { callClaudeJson } from '../lib/claude.js';
import { logger } from '../queues/index.js';
import { videoScriptSystemPrompt, videoScriptUserPrompt } from '../prompts/video-script.js';

/** Tentatives quand les validations MÉTIER échouent (le schéma est garanti par callClaudeJson). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** Script complet d'une vidéo : budget de sortie large. */
const SCRIPT_MAX_TOKENS = 16384;
/** Durée par défaut si l'outline n'a pas fixé de durationMin. */
const DEFAULT_DURATION_MIN = 5;
/** Tolérance sur le volume de narration vs durée cible × débit. */
const MIN_WORDS_RATIO = 0.5;
const MAX_WORDS_RATIO = 1.7;
/** Ouverture creuse proscrite par le brief instructeur. */
const FORBIDDEN_OPENING = /dans cette vid[ée]o,?\s+(nous|on)\s+(allons|va)/i;

export interface VideoScriptResult {
  lessonId: string;
  slides: number;
  narrationWords: number;
}

/** Nombre total de mots de narration du script. */
export function countNarrationWords(script: SlideScript): number {
  return script.slides.reduce((acc, slide) => acc + slide.narration.trim().split(/\s+/).length, 0);
}

/**
 * Validations métier au-delà du schéma Zod : 1re slide 'title', dernière
 * 'recap', slides 'code' complètes, pas d'ouverture creuse, narration calée
 * sur la durée cible. Retourne la liste des problèmes (vide = conforme).
 */
export function validateVideoScriptBusiness(script: SlideScript, durationMin: number): string[] {
  const problems: string[] = [];
  const first = script.slides[0];
  const last = script.slides[script.slides.length - 1];

  if (first?.template !== 'title') {
    problems.push(`La PREMIÈRE slide doit utiliser le template "title" (reçu : "${first?.template}").`);
  }
  if (last?.template !== 'recap') {
    problems.push(`La DERNIÈRE slide doit utiliser le template "recap" (reçu : "${last?.template}").`);
  }

  script.slides.forEach((slide, index) => {
    if (slide.template === 'code' && !slide.code?.trim()) {
      problems.push(`La slide ${index + 1} ("${slide.title}") est de template "code" mais son champ "code" est vide.`);
    }
    if (FORBIDDEN_OPENING.test(slide.narration)) {
      problems.push(
        `La narration de la slide ${index + 1} contient une formule creuse du type « dans cette vidéo nous allons » — entre directement dans le sujet.`,
      );
    }
    // Densité visuelle : une slide de contenu avec 0-1 puce laisse un écran
    // quasi vide pendant que la voix parle (constaté en rendu réel — le
    // spectateur croit qu'il « manque » du contenu). Titre/recap/code exemptés
    // (leur substance est ailleurs : accroche, synthèse, extrait de code).
    if (slide.template !== 'title' && slide.template !== 'recap' && slide.template !== 'code') {
      const bullets = (slide.bullets ?? []).filter((b) => b.trim().length > 0);
      if (bullets.length < 2) {
        problems.push(
          `La slide ${index + 1} ("${slide.title}") n'affiche que ${bullets.length} puce(s) — il en faut 2 à 5 reprenant les points clés de sa narration.`,
        );
      }
    }
  });

  // Rythme : ~45-75 s de narration par slide. Trop de slides = écran haché
  // (10 s/slide constaté), trop peu = tunnel monotone.
  const idealSlides = Math.max(4, Math.round((durationMin * 60) / 55));
  if (script.slides.length > idealSlides * 2) {
    problems.push(
      `${script.slides.length} slides pour ${durationMin} min : beaucoup trop haché — vise ${Math.max(4, idealSlides - 2)} à ${idealSlides + 2} slides plus riches (~1 minute de narration chacune).`,
    );
  }

  const targetWords = durationMin * AUDIO.NARRATION_WORDS_PER_MINUTE;
  const words = countNarrationWords(script);
  if (words < targetWords * MIN_WORDS_RATIO) {
    problems.push(
      `La narration totale fait ${words} mots — trop court pour ${durationMin} min à ~${AUDIO.NARRATION_WORDS_PER_MINUTE} mots/min (vise ~${Math.round(targetWords)} mots).`,
    );
  } else if (words > targetWords * MAX_WORDS_RATIO) {
    problems.push(
      `La narration totale fait ${words} mots — trop long pour ${durationMin} min à ~${AUDIO.NARRATION_WORDS_PER_MINUTE} mots/min (vise ~${Math.round(targetWords)} mots).`,
    );
  }

  return problems;
}

/**
 * Génère le script vidéo d'une leçon et le persiste : Lesson.script reçoit le
 * SlideScript validé et status passe à 'ready'. Jette en cas d'échec (le
 * dispatcher content-generation gère alors le statut 'failed').
 */
export async function generateVideoScript(params: {
  courseId: string;
  lessonId: string;
  /** Contexte de continuité (résumés des leçons précédentes, P19). */
  context?: string;
  /** Override de provider LLM pour cette régénération (« éditer avec l'IA »). */
  llmProviderId?: string;
}): Promise<VideoScriptResult> {
  const { courseId, lessonId, context, llmProviderId } = params;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'video') {
    throw new Error(`generateVideoScript : leçon ${lessonId} de type « ${lesson.type} » (attendu : video)`);
  }
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const durationMin = lesson.durationMin && lesson.durationMin > 0 ? lesson.durationMin : DEFAULT_DURATION_MIN;
  const system = videoScriptSystemPrompt();
  // Phase 10 (P167) — langue des slides ≠ langue de narration : le TEXTE des
  // slides (titres/puces) est rédigé dans slideLanguage, la NARRATION reste dans
  // la langue du cours. Vide si non demandé ou identique à la locale.
  const slideLang = course.advancedParams?.slideLanguage;
  const LANG_LABEL: Record<string, string> = { fr: 'français', en: 'anglais', ar: 'arabe' };
  const slideLangDirective =
    slideLang && slideLang !== course.locale
      ? `\n\nLANGUE DES SLIDES : rédige les TITRES et les PUCES des slides en ${LANG_LABEL[slideLang] ?? slideLang}, ` +
        `mais garde le champ "narration" de chaque slide en ${LANG_LABEL[course.locale] ?? course.locale}.`
      : '';

  const baseUser =
    videoScriptUserPrompt({
      lessonTitle: lesson.title,
      summary: lesson.summary,
      durationMin,
      courseTitle: course.title,
      difficulty: course.difficulty,
      locale: course.locale,
      context,
    }) +
    // Phase 10 — consignes avancées (pédagogie + domaine + OS/commentaires).
    renderGenerationDirectives(course.advancedParams, 'script') +
    slideLangDirective;

  // Boucle métier : schéma garanti par callClaudeJson, mais les règles du brief
  // (title/recap, volume, formules interdites) peuvent nécessiter un retry avec feedback.
  let script: SlideScript | null = null;
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_BUSINESS_ATTEMPTS; attempt++) {
    const user =
      feedback.length === 0
        ? baseUser
        : `${baseUser}\n\nTa précédente proposition violait ces règles — corrige-les impérativement :\n${feedback
            .map((p) => `- ${p}`)
            .join('\n')}`;

    const candidate = await callClaudeJson({
      // Réparation structurelle AVANT validation (garde-fou OSS, même esprit
      // que normalizeOutlineQuizzes) : les modèles locaux (qwen 3b/7b) laissent
      // souvent le `title` des slides de continuation VIDE — purement mécanique
      // à réparer (titre de leçon + n° de partie), et chaque retry LLM coûte
      // plusieurs minutes de CPU pour rien. Le contenu (narration/bullets)
      // reste celui du modèle, seule la structure est complétée.
      schema: z.preprocess((raw) => {
        const value = raw as { slides?: { title?: unknown; bullets?: unknown }[] } | null;
        if (value && Array.isArray(value.slides)) {
          value.slides.forEach((slide, i) => {
            if (typeof slide === 'object' && slide !== null && (!slide.title || String(slide.title).trim() === '')) {
              // Titre dérivé de la PREMIÈRE puce (sujet réel de la slide) plutôt
              // qu'un « — partie N » monotone ; repli sur le titre de leçon.
              const firstBullet = Array.isArray(slide.bullets)
                ? String(slide.bullets.find((b) => typeof b === 'string' && b.trim()) ?? '').trim()
                : '';
              slide.title = firstBullet || (i === 0 ? lesson.title : `${lesson.title} — partie ${i + 1}`);
            }
          });
        }
        return raw;
      }, slideScriptSchema),
      system,
      user,
      maxTokens: SCRIPT_MAX_TOKENS,
      // Retry métier (P72) : feedback potentiellement identique d'une tentative
      // à l'autre — désactive le cache pour ne pas rejouer la même réponse.
      skipCache: attempt > 1,
      cost: { courseId, userId: String(course.userId) },
      llmProviderId: llmProviderId ?? course.llmProvider,
    });

    feedback = validateVideoScriptBusiness(candidate, durationMin);
    if (feedback.length === 0) {
      script = candidate;
      break;
    }
    logger.warn({ lessonId, attempt, problems: feedback }, 'script vidéo non conforme aux règles métier');
  }

  if (!script) {
    throw new Error(
      `script vidéo non conforme après ${MAX_BUSINESS_ATTEMPTS} tentatives :\n${feedback.join('\n')}`,
    );
  }

  lesson.script = script;
  lesson.status = 'ready';
  await lesson.save();

  const result: VideoScriptResult = {
    lessonId,
    slides: script.slides.length,
    narrationWords: countNarrationWords(script),
  };
  logger.info({ courseId, ...result }, 'script vidéo généré et persisté');
  return result;
}
