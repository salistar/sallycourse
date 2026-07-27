// Phase 10 (P173) — DEVIS a priori d'un cours AVANT génération : volume
// (leçons/vidéos/quiz), coût estimé (cloud vs OSS) et métriques dérivées, à
// partir des paramètres de création (approxSections / advancedParams). Fonctions
// PURES (aucune I/O), réutilisées par l'écran de confirmation. Le TEMPS estimé
// vient d'ailleurs (historique des jobs, pipeline-estimate.ts côté web).
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { normalizeContentRatio } from './generation-params';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { claudeCostUsd, ttsCostUsdForProvider, renderCostUsd, imageCostUsd, computeOssCost } from './pricing-table';

/** Mots narrés par minute (aligné sur AUDIO.NARRATION_WORDS_PER_MINUTE). */
const NARRATION_WPM = 140;
/** Caractères moyens par mot (français) — pour convertir minutes → caractères TTS. */
const CHARS_PER_WORD = 6;
/** Milieu de plage (minutes) par preset de durée moyenne de vidéo. */
const AVG_VIDEO_MINUTES: Record<string, number> = { '3-5': 4, '5-8': 6.5, '8-12': 10 };
/** Leçons par section par défaut (≈ video + article + tp + quiz). */
const LESSONS_PER_SECTION = 4;
/** Tokens LLM moyens estimés par leçon (entrée / sortie). */
const LLM_TOKENS_IN_PER_LESSON = 1500;
const LLM_TOKENS_OUT_PER_LESSON = 2500;

export interface CourseVolumeInput {
  approxSections?: number | undefined;
  targetHours?: number | undefined;
  avgVideoLength?: '3-5' | '5-8' | '8-12' | undefined;
  contentRatio?: { video: number; article: number; tp: number; quiz: number } | undefined;
  narrationSpeed?: number | undefined;
}

export interface CourseVolume {
  sections: number;
  lessons: number;
  videos: number;
  articles: number;
  tps: number;
  quizzes: number;
  totalVideoMinutes: number;
  /** Caractères TTS estimés (narration de toutes les vidéos). */
  ttsChars: number;
  /** Secondes de vidéo produites (≈ durée totale des vidéos). */
  renderSeconds: number;
  /** Images générées (couverture + illustration par section). */
  images: number;
}

/**
 * Estime le VOLUME d'un cours. Priorité à `targetHours` (durée cible de vidéo)
 * si fournie, sinon dérive de `approxSections`. Ventile par type via le ratio
 * (normalisé). Toujours ≥ 1 vidéo et ≥ 1 quiz par section.
 */
export function estimateCourseVolume(input: CourseVolumeInput): CourseVolume {
  const avgVideoMin = AVG_VIDEO_MINUTES[input.avgVideoLength ?? '5-8'] ?? 6.5;
  const ratio = normalizeContentRatio(input.contentRatio);

  let lessons: number;
  let sections: number;
  if (input.targetHours && input.targetHours > 0) {
    const videoMinutes = input.targetHours * 60;
    const videos = Math.max(1, Math.round(videoMinutes / avgVideoMin));
    lessons = ratio.video > 0 ? Math.round(videos / (ratio.video / 100)) : videos * 4;
    sections = input.approxSections ?? Math.max(3, Math.round(lessons / LESSONS_PER_SECTION));
  } else {
    sections = input.approxSections ?? 8;
    lessons = sections * LESSONS_PER_SECTION;
  }
  lessons = Math.max(sections, lessons);

  const videos = Math.max(1, Math.round((lessons * ratio.video) / 100));
  const articles = Math.round((lessons * ratio.article) / 100);
  const tps = Math.round((lessons * ratio.tp) / 100);
  const quizzes = Math.max(sections, Math.round((lessons * ratio.quiz) / 100));
  const totalVideoMinutes = Math.round(videos * avgVideoMin);
  const speed = input.narrationSpeed && input.narrationSpeed > 0 ? input.narrationSpeed : 1;
  const ttsChars = Math.round((totalVideoMinutes * NARRATION_WPM * CHARS_PER_WORD) / speed);
  const renderSeconds = totalVideoMinutes * 60;
  const images = sections + 1;

  return { sections, lessons, videos, articles, tps, quizzes, totalVideoMinutes, ttsChars, renderSeconds, images };
}

export interface CourseCostInput {
  /** Id de modèle LLM facturé (défaut : Gemini gratuit). */
  llmModel?: string | undefined;
  /** Provider TTS effectif (edge/piper/kokoro = gratuit, modal/elevenlabs = payant). */
  ttsProvider?: string | undefined;
}

export interface CourseCostEstimate {
  cloudUsd: number;
  ossUsd: number;
  breakdown: { llmUsd: number; ttsUsd: number; renderUsd: number; imageUsd: number };
  tokensIn: number;
  tokensOut: number;
}

/**
 * Estime le COÛT d'un cours à partir de son volume, en réutilisant la table de
 * tarifs partagée. Fournit le coût cloud (selon le provider LLM/TTS choisi) ET
 * le coût OSS (compute Hetzner) pour un comparatif cohérent avec le dashboard.
 */
export function estimateCourseCost(volume: CourseVolume, input: CourseCostInput = {}): CourseCostEstimate {
  const tokensIn = volume.lessons * LLM_TOKENS_IN_PER_LESSON + 1500; // + plan
  const tokensOut = volume.lessons * LLM_TOKENS_OUT_PER_LESSON + 2500;
  const llmUsd = claudeCostUsd(input.llmModel ?? 'gemini-flash-latest', tokensIn, tokensOut);
  const ttsUsd = ttsCostUsdForProvider(input.ttsProvider ?? 'edge', volume.ttsChars);
  const renderUsd = renderCostUsd(volume.renderSeconds);
  const imageUsd = imageCostUsd(volume.images);
  const cloudUsd = round(llmUsd + ttsUsd + renderUsd + imageUsd);
  const oss = computeOssCost({
    tokensIn,
    tokensOut,
    chars: volume.ttsChars,
    renderSeconds: volume.renderSeconds,
    images: volume.images,
  });
  return {
    cloudUsd,
    ossUsd: round(oss.totalUsd),
    breakdown: { llmUsd: round(llmUsd), ttsUsd: round(ttsUsd), renderUsd: round(renderUsd), imageUsd: round(imageUsd) },
    tokensIn,
    tokensOut,
  };
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
