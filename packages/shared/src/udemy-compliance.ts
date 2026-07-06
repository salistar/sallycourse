// Vérification de conformité Udemy (Prompt 27) — audit d'un cours avant publication.
// Renvoie un score 0-100, un verdict passed (aucune erreur bloquante) et la liste
// des violations, avec correction suggérée quand elle est mécanique (troncature, casse…).
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import { UDEMY, type Locale } from './constants';
// @ts-ignore TS2835 — import sans extension, consommé en source par le worker (NodeNext)
import type { LessonType } from './schemas/course';

// ── Types publics ──────────────────────────────────────────────────────────

export type ComplianceSeverity = 'error' | 'warning';

export type ComplianceIssueCode =
  | 'TITLE_TOO_LONG'
  | 'TITLE_FORBIDDEN_WORD'
  | 'TITLE_EXCESSIVE_CAPS'
  | 'TITLE_MULTIPLE_EXCLAMATIONS'
  | 'TITLE_SUPERLATIVE_CLAIM'
  | 'SUBTITLE_TOO_LONG'
  | 'DESCRIPTION_TOO_SHORT'
  | 'OBJECTIVES_TOO_FEW'
  | 'VIDEO_TOO_SHORT'
  | 'SECTIONS_TOO_FEW'
  | 'IMAGE_MISSING'
  | 'IMAGE_WRONG_SIZE'
  | 'TEXT_CONTAINS_URL'
  | 'TEXT_CONTAINS_PROMO'
  | 'VIDEO_LESSON_WITHOUT_VIDEO';

export interface ComplianceFix {
  /** Champ de l'input auquel appliquer la valeur suggérée. */
  field: string;
  suggested: string;
}

export interface ComplianceIssue {
  code: ComplianceIssueCode;
  severity: ComplianceSeverity;
  message: string;
  fix?: ComplianceFix;
}

export interface UdemyComplianceLessonInput {
  type: LessonType;
  durationMin: number;
  hasVideo: boolean;
}

export interface UdemyComplianceInput {
  title: string;
  subtitle: string;
  description: string;
  learningObjectives: string[];
  totalVideoMinutes: number;
  sectionsCount: number;
  lessons: UdemyComplianceLessonInput[];
  courseImage?: { width: number; height: number };
  locale: Locale;
}

export interface UdemyComplianceReport {
  /** 0-100 : 100 - 15 par erreur - 5 par avertissement, plancher 0. */
  score: number;
  /** true si aucune issue de sévérité 'error'. */
  passed: boolean;
  issues: ComplianceIssue[];
}

// ── Barème et listes de détection ──────────────────────────────────────────

const SCORE_PENALTY: Record<ComplianceSeverity, number> = { error: 15, warning: 5 };

/** Seuil de majuscules abusives dans le titre (strictement supérieur). */
export const TITLE_UPPERCASE_MAX_RATIO = 0.3;

/** Longueur max d'un sigle tout en majuscules toléré (SQL, PHP, AWS…). */
const ACRONYM_MAX_LETTERS = 3;

// Mots interdits par Udemy dans le titre (FR/EN à frontière de mot, AR en sous-chaîne
// car \b ne fonctionne qu'avec les caractères ASCII).
const FORBIDDEN_TITLE_PATTERNS: readonly RegExp[] = [/\bgratuits?\b/i, /\bfree\b/i];
const FORBIDDEN_TITLE_SUBSTRINGS: readonly string[] = ['مجاني'];

// Allégations superlatives non vérifiables.
const SUPERLATIVE_PATTERNS: readonly RegExp[] = [/meilleure?s? cours/i, /best course/i];

// URLs et vocabulaire promotionnel, interdits dans titre/sous-titre/description.
const URL_PATTERN = /(https?:\/\/|www\.)/i;
const PROMO_PATTERNS: readonly RegExp[] = [
  /\b(promos?|promotions?|coupons?|discounts?|r[ée]ductions?)\b/i,
  /offre sp[ée]ciale/i,
];
const PROMO_SUBSTRINGS: readonly string[] = ['خصم'];

// ── Aides mécaniques (exportées : réutilisées par l'auto-fix côté web/worker) ──

/**
 * Troncature intelligente : coupe à maxChars en préférant la dernière frontière
 * de mot (si elle conserve au moins 60 % de la longueur cible), puis retire la
 * ponctuation pendante.
 */
export function smartTruncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  let cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxChars * 0.6)) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s,;:.!?…-]+$/u, '');
}

/**
 * Normalisation de casse : les mots tout en majuscules de plus de
 * ACRONYM_MAX_LETTERS lettres passent en Capitalisé ; les sigles courts restent.
 */
export function normalizeTitleCase(title: string): string {
  return title
    .split(' ')
    .map((word) => {
      const letters = [...word].filter((c) => c.toLowerCase() !== c.toUpperCase());
      const isAllCaps = letters.length > 0 && word === word.toUpperCase() && word !== word.toLowerCase();
      if (!isAllCaps || letters.length <= ACRONYM_MAX_LETTERS) return word;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Ratio de lettres majuscules dans le texte, sigles courts (≤ 3 lettres,
 * tout en majuscules) exclus du calcul pour éviter les faux positifs SQL/PHP.
 */
export function uppercaseRatio(text: string): number {
  let letters = 0;
  let uppers = 0;
  for (const word of text.split(/\s+/u)) {
    const chars = [...word].filter((c) => c.toLowerCase() !== c.toUpperCase());
    if (chars.length === 0) continue;
    if (chars.length <= ACRONYM_MAX_LETTERS && word === word.toUpperCase()) continue;
    for (const c of chars) {
      letters += 1;
      if (c === c.toUpperCase()) uppers += 1;
    }
  }
  return letters === 0 ? 0 : uppers / letters;
}

/** Nombre de mots (séparateurs = blancs), pour le seuil de description. */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((w) => w.length > 0).length;
}

// ── Vérification principale ────────────────────────────────────────────────

export function checkUdemyCompliance(input: UdemyComplianceInput): UdemyComplianceReport {
  const issues: ComplianceIssue[] = [];
  const push = (issue: ComplianceIssue): void => {
    issues.push(issue);
  };

  // Titre : longueur.
  if (input.title.length > UDEMY.TITLE_MAX_CHARS) {
    push({
      code: 'TITLE_TOO_LONG',
      severity: 'error',
      message: `Titre de ${input.title.length} caractères (maximum ${UDEMY.TITLE_MAX_CHARS}).`,
      fix: { field: 'title', suggested: smartTruncate(input.title, UDEMY.TITLE_MAX_CHARS) },
    });
  }

  // Titre : mots interdits (gratuit/free/مجاني) — la suppression est mécanique.
  for (const pattern of FORBIDDEN_TITLE_PATTERNS) {
    const match = input.title.match(pattern);
    if (match) {
      push({
        code: 'TITLE_FORBIDDEN_WORD',
        severity: 'error',
        message: `Le titre contient le mot interdit « ${match[0]} ».`,
        fix: {
          field: 'title',
          suggested: input.title.replace(pattern, '').replace(/\s{2,}/g, ' ').trim(),
        },
      });
    }
  }
  for (const word of FORBIDDEN_TITLE_SUBSTRINGS) {
    if (input.title.includes(word)) {
      push({
        code: 'TITLE_FORBIDDEN_WORD',
        severity: 'error',
        message: `Le titre contient le mot interdit « ${word} ».`,
        fix: {
          field: 'title',
          suggested: input.title.split(word).join('').replace(/\s{2,}/g, ' ').trim(),
        },
      });
    }
  }

  // Titre : majuscules abusives (> 30 % des lettres, sigles courts tolérés).
  const capsRatio = uppercaseRatio(input.title);
  if (capsRatio > TITLE_UPPERCASE_MAX_RATIO) {
    push({
      code: 'TITLE_EXCESSIVE_CAPS',
      severity: 'error',
      message: `Titre en majuscules à ${Math.round(capsRatio * 100)} % (maximum ${Math.round(TITLE_UPPERCASE_MAX_RATIO * 100)} %).`,
      fix: { field: 'title', suggested: normalizeTitleCase(input.title) },
    });
  }

  // Titre : points d'exclamation multiples.
  if (/!{2,}/.test(input.title)) {
    push({
      code: 'TITLE_MULTIPLE_EXCLAMATIONS',
      severity: 'error',
      message: 'Le titre contient des points d’exclamation répétés (« !! »).',
      fix: { field: 'title', suggested: input.title.replace(/!{2,}/g, '!') },
    });
  }

  // Titre : allégation superlative (« meilleur cours »…), reformulation humaine requise.
  for (const pattern of SUPERLATIVE_PATTERNS) {
    const match = input.title.match(pattern);
    if (match) {
      push({
        code: 'TITLE_SUPERLATIVE_CLAIM',
        severity: 'error',
        message: `Allégation invérifiable dans le titre : « ${match[0]} ».`,
      });
    }
  }

  // Sous-titre : longueur.
  if (input.subtitle.length > UDEMY.SUBTITLE_MAX_CHARS) {
    push({
      code: 'SUBTITLE_TOO_LONG',
      severity: 'error',
      message: `Sous-titre de ${input.subtitle.length} caractères (maximum ${UDEMY.SUBTITLE_MAX_CHARS}).`,
      fix: { field: 'subtitle', suggested: smartTruncate(input.subtitle, UDEMY.SUBTITLE_MAX_CHARS) },
    });
  }

  // Description : nombre de mots minimum.
  const words = countWords(input.description);
  if (words < UDEMY.DESCRIPTION_MIN_WORDS) {
    push({
      code: 'DESCRIPTION_TOO_SHORT',
      severity: 'error',
      message: `Description de ${words} mots (minimum ${UDEMY.DESCRIPTION_MIN_WORDS}).`,
    });
  }

  // Objectifs pédagogiques.
  if (input.learningObjectives.length < UDEMY.MIN_LEARNING_OBJECTIVES) {
    push({
      code: 'OBJECTIVES_TOO_FEW',
      severity: 'error',
      message: `${input.learningObjectives.length} objectif(s) pédagogique(s) (minimum ${UDEMY.MIN_LEARNING_OBJECTIVES}).`,
    });
  }

  // Volume vidéo total.
  if (input.totalVideoMinutes < UDEMY.MIN_TOTAL_VIDEO_MINUTES) {
    push({
      code: 'VIDEO_TOO_SHORT',
      severity: 'error',
      message: `${input.totalVideoMinutes} minute(s) de vidéo (minimum ${UDEMY.MIN_TOTAL_VIDEO_MINUTES}).`,
    });
  }

  // Nombre de sections.
  if (input.sectionsCount < UDEMY.MIN_SECTIONS) {
    push({
      code: 'SECTIONS_TOO_FEW',
      severity: 'error',
      message: `${input.sectionsCount} section(s) (minimum ${UDEMY.MIN_SECTIONS}).`,
    });
  }

  // Image de cours : dimensions exactes exigées par Udemy.
  const { width: expectedW, height: expectedH } = UDEMY.COURSE_IMAGE;
  if (!input.courseImage) {
    push({
      code: 'IMAGE_MISSING',
      severity: 'warning',
      message: `Aucune image de cours fournie (attendu ${expectedW}x${expectedH}).`,
    });
  } else if (input.courseImage.width !== expectedW || input.courseImage.height !== expectedH) {
    push({
      code: 'IMAGE_WRONG_SIZE',
      severity: 'error',
      message: `Image ${input.courseImage.width}x${input.courseImage.height} (attendu exactement ${expectedW}x${expectedH}).`,
      fix: { field: 'courseImage', suggested: `${expectedW}x${expectedH}` },
    });
  }

  // URLs et vocabulaire promotionnel dans les textes visibles.
  const textFields: ReadonlyArray<readonly [string, string]> = [
    ['title', input.title],
    ['subtitle', input.subtitle],
    ['description', input.description],
  ];
  for (const [field, value] of textFields) {
    if (URL_PATTERN.test(value)) {
      push({
        code: 'TEXT_CONTAINS_URL',
        severity: 'error',
        message: `Le champ « ${field} » contient une URL, interdite par Udemy.`,
      });
    }
    const hasPromo =
      PROMO_PATTERNS.some((p) => p.test(value)) || PROMO_SUBSTRINGS.some((s) => value.includes(s));
    if (hasPromo) {
      push({
        code: 'TEXT_CONTAINS_PROMO',
        severity: 'error',
        message: `Le champ « ${field} » contient du vocabulaire promotionnel, interdit par Udemy.`,
      });
    }
  }

  // Cohérence des leçons : une leçon de type vidéo doit embarquer une vidéo.
  const videoLessonsWithoutVideo = input.lessons.filter((l) => l.type === 'video' && !l.hasVideo).length;
  if (videoLessonsWithoutVideo > 0) {
    push({
      code: 'VIDEO_LESSON_WITHOUT_VIDEO',
      severity: 'warning',
      message: `${videoLessonsWithoutVideo} leçon(s) de type vidéo sans fichier vidéo associé.`,
    });
  }

  const score = Math.max(
    0,
    100 - issues.reduce((total, issue) => total + SCORE_PENALTY[issue.severity], 0),
  );
  const passed = issues.every((issue) => issue.severity !== 'error');
  return { score, passed, issues };
}
