// Mode « compliance maximale » Udemy (Prompt 48).
//
// Avant un déploiement Udemy, on applique/vérifie toutes les bonnes pratiques
// anti-rejet au-delà du contrôle de base (checkUdemyCompliance de @sallycourse/shared) :
//  - présence d'une vraie vidéo d'intro webcam ~60 s (Course.introVideoKey) ;
//  - absence de liens externes / vocabulaire promo dans les articles et scripts ;
//  - watermark discret activé (flag) ;
//  - audio normalisé à -16 LUFS (fait au TTS — on VÉRIFIE le flag) ;
//  - pas de slide « texte seul » affichée > 45 s d'affilée (analyse du script →
//    on recommande d'insérer une capture/un schéma).
//
// Ce module est PUR : il reçoit des entrées déjà extraites (textes d'articles,
// scripts de slides, flags) et retourne un rapport enrichi. Aucun accès réseau
// ni stockage ici → testable hors-ligne. L'adapter Udemy fera l'extraction.

// @ts-ignore TS6059 — source hors rootDir, typage intact (voir shared.ts)
import {
  checkUdemyCompliance,
  AUDIO,
  type UdemyComplianceInput,
  type UdemyComplianceReport,
  type ComplianceIssue,
  type ComplianceSeverity,
} from '../shared.js';
import { toComplianceNote, type OriginalityReport } from '../lib/plagiarism-check.js';

/* ------------------------------------------------------------------ */
/* Types publics                                                       */
/* ------------------------------------------------------------------ */

/** Codes propres au mode compliance maximale (préfixe MAX_ pour les distinguer). */
export type MaxComplianceCode =
  | 'MAX_INTRO_VIDEO_MISSING'
  | 'MAX_INTRO_VIDEO_TOO_SHORT'
  | 'MAX_INTRO_VIDEO_TOO_LONG'
  | 'MAX_LESSON_CONTAINS_URL'
  | 'MAX_LESSON_CONTAINS_PROMO'
  | 'MAX_WATERMARK_DISABLED'
  | 'MAX_AUDIO_NOT_NORMALIZED'
  | 'MAX_SLIDE_TEXT_ONLY_TOO_LONG'
  | 'MAX_ORIGINALITY_LOW';

/** Une remarque du contrôle renforcé (même forme que ComplianceIssue, code étendu). */
export interface MaxComplianceIssue {
  code: MaxComplianceCode;
  severity: ComplianceSeverity;
  message: string;
  /** Référence de localisation (ex. « leçon 3 », « slide 5 ») pour guider la correction. */
  location?: string;
}

/** Contenu textuel d'une leçon à scanner (article Markdown OU script de slides). */
export interface LessonTextInput {
  /** Titre pour le message de localisation. */
  title: string;
  /** Texte agrégé à scanner : Markdown de l'article et/ou narrations de slides. */
  text: string;
}

/** Une slide du script, réduite aux champs utiles à l'analyse « texte seul ». */
export interface SlideDurationInput {
  /** Titre de la slide (localisation). */
  title: string;
  /** Gabarit de la slide (title/content/code/diagram…). */
  template: string;
  /** true si la slide porte un visuel (code, schéma, capture, image). */
  hasVisual: boolean;
  /** Durée d'affichage mesurée en secondes (audioSeconds du script). */
  seconds: number;
}

/** Entrées du contrôle renforcé (toutes déjà extraites, aucune I/O). */
export interface MaxComplianceInput {
  /** Entrée standard réutilisée telle quelle pour le contrôle de base. */
  base: UdemyComplianceInput;
  /** Vidéo d'intro webcam : présence + durée (0/absente → manquante). */
  introVideo?: { present: boolean; durationSec?: number };
  /** Textes des leçons (articles + narrations) à scanner pour liens/promo. */
  lessonTexts: LessonTextInput[];
  /** Slides du script (toutes leçons vidéo confondues) pour l'analyse temporelle. */
  slides: SlideDurationInput[];
  /** Watermark discret demandé (flag de rendu vidéo). */
  watermarkEnabled: boolean;
  /** Audio déclaré normalisé -16 LUFS (fait au TTS/rendu). */
  audioNormalized: boolean;
  /**
   * Rapports d'originalité (P141, worker/lib/plagiarism-check.ts) déjà calculés
   * pour les leçons du cours, associés à leur titre. Optionnel et additif —
   * absent → aucune remarque MAX_ORIGINALITY_LOW (comportement historique
   * inchangé). Vérification best-effort, jamais bloquante (toujours 'warning').
   */
  originalityReports?: Array<{ lessonTitle: string; report: OriginalityReport }>;
}

/** Rapport renforcé : rapport de base + remarques MAX + score/verdict combinés. */
export interface MaxComplianceReport {
  /** Rapport standard (issues de base, score, passed). */
  base: UdemyComplianceReport;
  /** Remarques propres au mode renforcé. */
  maxIssues: MaxComplianceIssue[];
  /**
   * Score combiné 0-100 : score de base moins les pénalités des remarques MAX
   * (même barème : -15 par erreur, -5 par avertissement), plancher 0.
   */
  score: number;
  /** true si NI le contrôle de base NI le contrôle renforcé n'ont d'erreur bloquante. */
  passed: boolean;
}

/* ------------------------------------------------------------------ */
/* Barème et seuils                                                    */
/* ------------------------------------------------------------------ */

const SCORE_PENALTY: Record<ComplianceSeverity, number> = { error: 15, warning: 5 };

/** Bornes de durée de la vidéo d'intro webcam (secondes). */
export const INTRO_VIDEO = { MIN_SEC: 45, MAX_SEC: 120, TARGET_SEC: 60 } as const;

/** Durée max d'affichage d'une slide « texte seul » avant de recommander un visuel (s). */
export const TEXT_ONLY_SLIDE_MAX_SEC = 45;

/** Gabarits considérés comme portant un visuel intrinsèque (jamais « texte seul »). */
const VISUAL_TEMPLATES: ReadonlySet<string> = new Set(['code', 'diagram', 'comparison']);

// Détection de liens externes et de vocabulaire promotionnel dans le CORPS des leçons.
// Plus large que le contrôle de base (qui ne scanne que titre/sous-titre/description).
const URL_PATTERN = /(https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,})/i;
const PROMO_PATTERNS: readonly RegExp[] = [
  /\b(promos?|promotions?|coupons?|discounts?|r[ée]ductions?)\b/i,
  /\bcode\s+promo\b/i,
  /offre\s+sp[ée]ciale/i,
  /\b(abonnez-vous|suivez-moi|follow\s+me|subscribe)\b/i,
];
const PROMO_SUBSTRINGS: readonly string[] = ['خصم'];

/* ------------------------------------------------------------------ */
/* Règles PURES (testables une par une)                                */
/* ------------------------------------------------------------------ */

/**
 * Évalue la vidéo d'intro webcam : présente et de durée ~60 s (bornes INTRO_VIDEO).
 * Absente → erreur ; trop courte/longue → avertissement (utilisable mais à revoir).
 */
export function checkIntroVideo(
  introVideo: MaxComplianceInput['introVideo'],
): MaxComplianceIssue | null {
  if (!introVideo || !introVideo.present) {
    return {
      code: 'MAX_INTRO_VIDEO_MISSING',
      severity: 'error',
      message:
        'Aucune vidéo d’intro webcam : Udemy attend une présentation en caméra ' +
        `(~${INTRO_VIDEO.TARGET_SEC} s) pour humaniser le cours.`,
    };
  }
  const sec = introVideo.durationSec ?? 0;
  if (sec > 0 && sec < INTRO_VIDEO.MIN_SEC) {
    return {
      code: 'MAX_INTRO_VIDEO_TOO_SHORT',
      severity: 'warning',
      message: `Vidéo d’intro de ${Math.round(sec)} s (minimum conseillé ${INTRO_VIDEO.MIN_SEC} s).`,
    };
  }
  if (sec > INTRO_VIDEO.MAX_SEC) {
    return {
      code: 'MAX_INTRO_VIDEO_TOO_LONG',
      severity: 'warning',
      message: `Vidéo d’intro de ${Math.round(sec)} s (maximum conseillé ${INTRO_VIDEO.MAX_SEC} s).`,
    };
  }
  return null;
}

/**
 * Scanne le corps d'une leçon : signale un lien externe et/ou du vocabulaire
 * promotionnel (interdits par Udemy hors ressources pédagogiques légitimes).
 * Retourne 0, 1 ou 2 remarques (URL et promo étant indépendantes).
 */
export function scanLessonText(lesson: LessonTextInput, index: number): MaxComplianceIssue[] {
  const issues: MaxComplianceIssue[] = [];
  const location = `leçon ${index + 1} « ${lesson.title} »`;
  const text = lesson.text ?? '';
  if (URL_PATTERN.test(text)) {
    issues.push({
      code: 'MAX_LESSON_CONTAINS_URL',
      severity: 'error',
      message: `${location} contient un lien externe, à retirer avant soumission Udemy.`,
      location,
    });
  }
  const hasPromo =
    PROMO_PATTERNS.some((p) => p.test(text)) || PROMO_SUBSTRINGS.some((s) => text.includes(s));
  if (hasPromo) {
    issues.push({
      code: 'MAX_LESSON_CONTAINS_PROMO',
      severity: 'error',
      message: `${location} contient du vocabulaire promotionnel, interdit par Udemy.`,
      location,
    });
  }
  return issues;
}

/**
 * Indique si une slide est « texte seul » : pas de visuel intrinsèque (code,
 * schéma, comparaison) et aucun visuel/capture explicitement attaché.
 */
export function isTextOnlySlide(slide: SlideDurationInput): boolean {
  if (slide.hasVisual) return false;
  return !VISUAL_TEMPLATES.has(slide.template);
}

/**
 * Repère les slides « texte seul » affichées trop longtemps (> 45 s) : au-delà,
 * l'attention chute et Udemy le relève → on recommande une capture/un schéma.
 */
export function scanSlideDurations(slides: SlideDurationInput[]): MaxComplianceIssue[] {
  const issues: MaxComplianceIssue[] = [];
  slides.forEach((slide, i) => {
    if (isTextOnlySlide(slide) && slide.seconds > TEXT_ONLY_SLIDE_MAX_SEC) {
      const location = `slide ${i + 1} « ${slide.title} »`;
      issues.push({
        code: 'MAX_SLIDE_TEXT_ONLY_TOO_LONG',
        severity: 'warning',
        message:
          `${location} reste ${Math.round(slide.seconds)} s en texte seul ` +
          `(> ${TEXT_ONLY_SLIDE_MAX_SEC} s) : insérer une capture ou un schéma.`,
        location,
      });
    }
  });
  return issues;
}

/**
 * Vérifie les flags de rendu : watermark discret activé et audio -16 LUFS.
 * Le watermark manquant est un avertissement (recommandation) ; l'audio non
 * normalisé aussi (le pipeline TTS le garantit normalement, on double-vérifie).
 */
export function checkRenderFlags(input: MaxComplianceInput): MaxComplianceIssue[] {
  const issues: MaxComplianceIssue[] = [];
  if (!input.watermarkEnabled) {
    issues.push({
      code: 'MAX_WATERMARK_DISABLED',
      severity: 'warning',
      message: 'Watermark discret désactivé : recommandé pour dissuader la rediffusion.',
    });
  }
  if (!input.audioNormalized) {
    issues.push({
      code: 'MAX_AUDIO_NOT_NORMALIZED',
      severity: 'warning',
      message: `Audio non normalisé à ${AUDIO.TARGET_LUFS} LUFS : niveau sonore hétérogène possible.`,
    });
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* Vérification renforcée complète                                     */
/* ------------------------------------------------------------------ */

/**
 * Contrôle « compliance maximale » : lance le contrôle de base puis empile les
 * remarques renforcées (intro, liens/promo, watermark, audio, slides longues).
 * Le score et le verdict combinent les deux niveaux.
 */
export function checkUdemyMaxCompliance(input: MaxComplianceInput): MaxComplianceReport {
  const base = checkUdemyCompliance(input.base);

  const maxIssues: MaxComplianceIssue[] = [];

  const intro = checkIntroVideo(input.introVideo);
  if (intro) maxIssues.push(intro);

  input.lessonTexts.forEach((lesson, i) => {
    maxIssues.push(...scanLessonText(lesson, i));
  });

  maxIssues.push(...scanSlideDurations(input.slides));
  maxIssues.push(...checkRenderFlags(input));

  // Détection de plagiat sortant (P141) — vérification supplémentaire OPTIONNELLE :
  // n'ajoute une remarque que si l'appelant a fourni des rapports déjà calculés
  // (aucun appel réseau ici, ce module reste pur). Toujours 'warning', jamais
  // bloquant — cohérent avec la nature best-effort documentée dans le rapport.
  for (const { lessonTitle, report } of input.originalityReports ?? []) {
    const note = toComplianceNote(report, lessonTitle);
    if (note) maxIssues.push(note as MaxComplianceIssue);
  }

  const maxPenalty = maxIssues.reduce((sum, issue) => sum + SCORE_PENALTY[issue.severity], 0);
  const score = Math.max(0, base.score - maxPenalty);
  const passed = base.passed && maxIssues.every((issue) => issue.severity !== 'error');

  return { base, maxIssues, score, passed };
}

/**
 * Fusionne les issues des deux niveaux en une liste plate (base d'abord),
 * pour un affichage/log unifié. Les codes MAX_ restent reconnaissables.
 */
export function flattenIssues(
  report: MaxComplianceReport,
): Array<ComplianceIssue | MaxComplianceIssue> {
  return [...report.base.issues, ...report.maxIssues];
}

/* ------------------------------------------------------------------ */
/* Extraction PURE depuis un script de slides (lesson.script)          */
/* ------------------------------------------------------------------ */

/** Gabarits considérés comme portant un visuel (aligné sur VISUAL_TEMPLATES). */
const VISUAL_SLIDE_TEMPLATES: ReadonlySet<string> = new Set(['code', 'diagram', 'comparison']);

/** Accès défensif au tableau de slides d'un script de structure inconnue. */
function slidesOf(script: unknown): Array<Record<string, unknown>> {
  if (!script || typeof script !== 'object') return [];
  const raw = (script as { slides?: unknown }).slides;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object');
}

/**
 * Extrait les textes narrés (narration) d'un script de slides — servent à
 * scanner liens/promo dans les leçons vidéo. Chaîne(s) non vide(s) uniquement.
 */
export function extractSlideTexts(script: unknown): string[] {
  return slidesOf(script)
    .map((s) => (typeof s.narration === 'string' ? s.narration : ''))
    .filter((t) => t.length > 0);
}

/**
 * Extrait les durées de slides pour l'analyse « texte seul » : titre, gabarit,
 * présence d'un visuel (champ `code`/gabarit visuel) et durée (audioSeconds).
 * Une slide sans audioSeconds est ignorée (durée inconnue → non contrôlable).
 */
export function extractSlideDurations(script: unknown): SlideDurationInput[] {
  const out: SlideDurationInput[] = [];
  for (const s of slidesOf(script)) {
    const seconds = typeof s.audioSeconds === 'number' ? s.audioSeconds : 0;
    if (seconds <= 0) continue;
    const template = typeof s.template === 'string' ? s.template : 'content';
    const hasVisual = VISUAL_SLIDE_TEMPLATES.has(template) || typeof s.code === 'string';
    out.push({
      title: typeof s.title === 'string' ? s.title : '',
      template,
      hasVisual,
      seconds,
    });
  }
  return out;
}
