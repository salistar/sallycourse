// Dérivation d'un cours (P64) : logique PURE de déclinaison d'un cours existant
// vers une autre langue (traduction de l'outline) ou un autre niveau de
// difficulté (même outline, contenu régénéré ensuite au niveau cible). Aucune
// I/O ici — l'appel LLM et la persistance vivent dans le processor.
import { outlineSchema, type Difficulty, type Locale, type Outline } from '../shared.js';

/**
 * Spécification d'une dérivation validée. `translate` indique si l'outline doit
 * être re-traduit par le LLM (langue cible ≠ langue source). `difficulty` est le
 * niveau du cours dérivé (identique à la source si non redéfini).
 */
export interface DerivationSpec {
  sourceLocale: Locale;
  targetLocale: Locale;
  sourceDifficulty: Difficulty;
  targetDifficulty: Difficulty;
  /** Vrai si la langue change → l'outline doit être traduit. */
  translate: boolean;
}

export type DerivationPlan =
  | { ok: true; spec: DerivationSpec }
  | { ok: false; reason: 'no_change' };

/**
 * Construit la spec d'une dérivation à partir de la source et des cibles
 * optionnelles. Retourne `no_change` si ni la langue ni le niveau ne changent
 * (une déclinaison strictement identique n'a aucun intérêt).
 */
export function planDerivation(input: {
  sourceLocale: Locale;
  sourceDifficulty: Difficulty;
  targetLocale?: Locale;
  targetDifficulty?: Difficulty;
}): DerivationPlan {
  const targetLocale = input.targetLocale ?? input.sourceLocale;
  const targetDifficulty = input.targetDifficulty ?? input.sourceDifficulty;

  if (targetLocale === input.sourceLocale && targetDifficulty === input.sourceDifficulty) {
    return { ok: false, reason: 'no_change' };
  }

  return {
    ok: true,
    spec: {
      sourceLocale: input.sourceLocale,
      targetLocale,
      sourceDifficulty: input.sourceDifficulty,
      targetDifficulty,
      translate: targetLocale !== input.sourceLocale,
    },
  };
}

/**
 * Titre du cours dérivé : réutilise le titre traduit si l'outline a été
 * re-traduit, sinon conserve le titre source (changement de niveau seul).
 */
export function derivedCourseTitle(sourceTitle: string, spec: DerivationSpec, translatedOutline?: Outline): string {
  if (spec.translate && translatedOutline?.title) return translatedOutline.title;
  return sourceTitle;
}

// ── Schéma de traduction ────────────────────────────────────────
/**
 * L'outline traduit DOIT conserver exactement la même structure (nombre de
 * sections, nombre de leçons par section, types et durées) : seul le TEXTE est
 * traduit. On réutilise donc `outlineSchema` comme contrat de sortie.
 */
export const translatedOutlineSchema = outlineSchema;

/**
 * Vérifie qu'un outline traduit préserve la structure de l'original : mêmes
 * sections, mêmes leçons (type + durée), l'ordre inchangé. Retourne la liste des
 * écarts (vide si la structure est fidèle) — réinjectée au LLM en cas d'échec.
 * La traduction ne doit JAMAIS modifier le squelette pédagogique validé.
 */
export function validateTranslationStructure(original: Outline, translated: Outline): string[] {
  const problems: string[] = [];

  if (translated.sections.length !== original.sections.length) {
    problems.push(
      `Nombre de sections divergent : ${translated.sections.length} au lieu de ${original.sections.length}.`,
    );
    // Écart structurel majeur : inutile de comparer plus loin section par section.
    return problems;
  }

  original.sections.forEach((section, sIndex) => {
    const translatedSection = translated.sections[sIndex];
    if (!translatedSection) return;

    if (translatedSection.lessons.length !== section.lessons.length) {
      problems.push(
        `Section ${sIndex + 1} : ${translatedSection.lessons.length} leçons au lieu de ${section.lessons.length}.`,
      );
      return;
    }

    section.lessons.forEach((lesson, lIndex) => {
      const translatedLesson = translatedSection.lessons[lIndex];
      if (!translatedLesson) return;
      if (translatedLesson.type !== lesson.type) {
        problems.push(
          `Section ${sIndex + 1}, leçon ${lIndex + 1} : type « ${translatedLesson.type} » au lieu de « ${lesson.type} ».`,
        );
      }
      if (translatedLesson.durationMin !== lesson.durationMin) {
        problems.push(
          `Section ${sIndex + 1}, leçon ${lIndex + 1} : durée ${translatedLesson.durationMin} min au lieu de ${lesson.durationMin} min.`,
        );
      }
    });
  });

  return problems;
}

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système de traduction : conserver la structure, traduire uniquement le texte. */
export function translateOutlineSystemPrompt(): string {
  return [
    `Tu es un traducteur pédagogique professionnel spécialisé dans les cours en ligne.`,
    `On te fournit le plan JSON d'un cours déjà validé. Tu dois le TRADUIRE fidèlement.`,
    ``,
    `RÈGLES IMPÉRATIVES :`,
    `1. Conserve EXACTEMENT la même structure : même nombre de sections, même nombre de leçons par section, même ordre.`,
    `2. Ne modifie JAMAIS les champs "type" (video|article|tp|quiz) ni "durationMin" — recopie-les à l'identique.`,
    `3. Traduis uniquement les textes : "title", "subtitle", "description", "learningObjectives", "prerequisites", "targetAudience", et les "title"/"summary" des sections et leçons.`,
    `4. Traduction naturelle et idiomatique dans la langue cible, pas de mot-à-mot.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec l'objet JSON traduit (aucun texte autour, aucune fence Markdown), au même schéma que l'entrée.`,
  ].join('\n');
}

/** Prompt utilisateur de traduction : langue cible + outline source sérialisé. */
export function translateOutlineUserPrompt(outline: Outline, targetLocale: Locale): string {
  return [
    `Traduis intégralement ce plan de cours en ${LOCALE_LABELS[targetLocale]}.`,
    `Le titre du cours traduit sera « ${outline.title} » (à traduire lui aussi).`,
    ``,
    `Plan source (JSON) :`,
    JSON.stringify(outline, null, 2),
  ].join('\n');
}
