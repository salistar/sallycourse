import { z } from 'zod';

// Schémas des contenus de leçons produits par le worker (Prompt 15+).
// slideScriptSchema est le contrat du script vidéo : une suite de slides
// typées (templates du design system D7) avec narration mot à mot.

/** Templates de slides disponibles (alignés sur @sallycourse/design, D7). */
export const SLIDE_TEMPLATES = [
  'title',
  'content',
  'code',
  'comparison',
  'quote',
  'diagram',
  'recap',
  'section-transition',
] as const;

export const slideTemplateSchema = z.enum(SLIDE_TEMPLATES);
export type SlideTemplate = z.infer<typeof slideTemplateSchema>;

export const slideSchema = z.object({
  template: slideTemplateSchema,
  title: z.string().min(1),
  bullets: z.array(z.string()),
  /** Extrait de code affiché — requis en pratique quand template === 'code'. */
  code: z.string().optional(),
  language: z.string().optional(),
  /** Narration mot à mot lue par le TTS pendant l'affichage de la slide. */
  narration: z.string().min(1),
  /** Notes internes (indications de mise en scène, non lues). */
  notes: z.string().optional(),
  /** Clé S3 du mp3 narré de la slide, posée par tts-generation (P23). Rétro-compatible. */
  audioKey: z.string().min(1).optional(),
  /** Durée mesurée de l'audio de la slide, en secondes (ffprobe). Rétro-compatible. */
  audioSeconds: z.number().positive().optional(),
});
export type Slide = z.infer<typeof slideSchema>;

export const slideScriptSchema = z.object({
  slides: z.array(slideSchema).min(2),
});
export type SlideScript = z.infer<typeof slideScriptSchema>;

// ── Article (leçon type "article", Prompt 16) ───────────────────
/** Bornes rédactionnelles d'un article de leçon (règles métier, hors schéma). */
export const ARTICLE = {
  MIN_WORDS: 800,
  MAX_WORDS: 1500,
  /** Nombre minimal de sections H2 attendu dans le Markdown. */
  MIN_H2_SECTIONS: 2,
} as const;

/**
 * Contenu d'un article : Markdown structuré (H2/H3), encadrés
 * `> **À retenir**` et placeholders `{{screenshot:description précise}}`
 * pour les captures d'écran produites plus tard par screenshot-capture.
 */
export const articleContentSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
});
export type ArticleContent = z.infer<typeof articleContentSchema>;

/** Liste les descriptions des placeholders `{{screenshot:…}}` d'un Markdown. */
export function extractScreenshotPlaceholders(markdown: string): string[] {
  const out: string[] = [];
  const re = /\{\{screenshot:([^}]+)\}\}/g;
  for (let m = re.exec(markdown); m !== null; m = re.exec(markdown)) {
    const description = m[1]?.trim();
    if (description) out.push(description);
  }
  return out;
}

// ── TP (leçon type "tp", Prompt 17) ─────────────────────────────
// Contrat du contenu d'une leçon "tp" (stocké dans Lesson.script) : chaque
// étape sur ordinateur embarque un screenshotSpec rejouable par Playwright
// (module de capture P21).

/** Action Playwright élémentaire pour rejouer un état d'écran. */
export const tpScreenshotActionSchema = z
  .object({
    type: z.enum(['goto', 'click', 'fill', 'scroll', 'wait']),
    /** Sélecteur CSS ciblé — requis pour click/fill, optionnel pour wait. */
    selector: z.string().min(1).optional(),
    /** Valeur associée : URL pour goto, texte pour fill, pixels pour scroll, ms pour wait. */
    value: z.string().min(1).optional(),
  })
  .superRefine((action, ctx) => {
    if ((action.type === 'click' || action.type === 'fill') && !action.selector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `l'action "${action.type}" exige un "selector" CSS`,
      });
    }
    if ((action.type === 'goto' || action.type === 'fill') && !action.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `l'action "${action.type}" exige une "value" (URL pour goto, texte pour fill)`,
      });
    }
  });
export type TpScreenshotAction = z.infer<typeof tpScreenshotActionSchema>;

/**
 * Spécification de capture autonome, exploitable telle quelle par Playwright :
 * page de départ (url ou première action goto), actions, focus et légende.
 */
export const tpScreenshotSpecSchema = z
  .object({
    /** Page de départ — peut être omise si la première action est un "goto". */
    url: z.string().url().optional(),
    actions: z.array(tpScreenshotActionSchema),
    /** Élément à mettre en évidence sur la capture (annotations D9). */
    focusSelector: z.string().min(1).optional(),
    /** Légende affichée sous la capture dans le TP. */
    caption: z.string().min(1),
  })
  .superRefine((spec, ctx) => {
    if (!spec.url && spec.actions[0]?.type !== 'goto') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'screenshotSpec doit fournir "url" ou commencer par une action "goto" — sinon Playwright n\'a pas de page de départ',
      });
    }
  });
export type TpScreenshotSpec = z.infer<typeof tpScreenshotSpecSchema>;

export const tpStepSchema = z.object({
  instruction: z.string().min(1),
  /** Commande shell exacte à exécuter, le cas échéant. */
  command: z.string().min(1).optional(),
  expectedResult: z.string().min(1),
  /** Obligatoire pour toute étape réalisée sur ordinateur (contrat capture P21). */
  screenshotSpec: tpScreenshotSpecSchema.optional(),
});
export type TpStep = z.infer<typeof tpStepSchema>;

/** Contenu complet d'une leçon de type "tp". */
export const tpSchema = z.object({
  objective: z.string().min(1),
  environment: z.array(z.string().min(1)).min(1),
  steps: z.array(tpStepSchema).min(3),
  validation: z.array(z.string().min(1)).min(1),
  troubleshooting: z.array(z.string().min(1)).min(1),
});
export type TpContent = z.infer<typeof tpSchema>;

// ── Marketing du cours (Prompt 28) ──────────────────────────────
// Landing marketing générée en fin de pipeline : description Udemy SEO,
// messages d'accueil/félicitations, texte promo et idées de titres scorées.
// La contrainte « >= UDEMY.DESCRIPTION_MIN_WORDS mots » est une règle métier
// vérifiée par le générateur (retry + feedback), pas par le schéma.

/** Nombre d'idées de titres alternatives attendues. */
export const MARKETING_TITLE_IDEAS = 5;

export const titleIdeaSchema = z.object({
  title: z.string().min(1),
  /** Potentiel commercial estimé (0-100). */
  score: z.number().min(0).max(100),
  /** Justification courte du score (mots-clés, promesse, clarté…). */
  reason: z.string().min(1),
});
export type TitleIdea = z.infer<typeof titleIdeaSchema>;

export const marketingSchema = z.object({
  /** Description Udemy optimisée SEO (bénéfices, programme, public visé). */
  udemyDescription: z.string().min(1),
  /** Message de bienvenue envoyé à l'inscription. */
  welcomeMessage: z.string().min(1),
  /** Message de félicitations envoyé à la fin du cours. */
  congratsMessage: z.string().min(1),
  /** Texte promotionnel court (réseaux sociaux, annonces). */
  promoText: z.string().min(1),
  titleIdeas: z.array(titleIdeaSchema).length(MARKETING_TITLE_IDEAS),
});
export type MarketingContent = z.infer<typeof marketingSchema>;
