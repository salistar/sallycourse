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

// ── Slides enrichies par type de contenu (Prompt 83) ────────────────
// Détection automatique du type de contenu d'une slide "diagram" : schéma
// Mermaid embarqué en texte (mermaidSource), tableau de comparaison structuré
// (comparisonTable) ou frise chronologique (timeline). Champs 100% optionnels
// et additifs : une slide sans ces champs se comporte exactement comme avant
// (dégradation gracieuse déjà assurée par buildSlideTemplate côté worker).

/** Syntaxe Mermaid minimale supportée par le parseur de repli (flowchart). */
export const mermaidDiagramSchema = z.object({
  /** Texte Mermoid brut tel que produit par le LLM (ex. "flowchart TD\nA-->B"). */
  source: z.string().min(1),
});
export type MermaidDiagram = z.infer<typeof mermaidDiagramSchema>;

/** Ligne de tableau comparatif : une valeur par colonne (même ordre que `columns`). */
export const comparisonTableRowSchema = z.object({
  label: z.string().min(1),
  values: z.array(z.string()).min(1),
});
export type ComparisonTableRow = z.infer<typeof comparisonTableRowSchema>;

/** Tableau de comparaison structuré (au-delà des 2 colonnes du gabarit "comparison" simple). */
export const comparisonTableSchema = z.object({
  columns: z.array(z.string().min(1)).min(1).max(4),
  rows: z.array(comparisonTableRowSchema).min(1).max(8),
});
export type ComparisonTable = z.infer<typeof comparisonTableSchema>;

/** Étape datée d'une frise chronologique. */
export const timelineStepSchema = z.object({
  /** Date ou repère temporel affiché tel quel (ex. "2024", "Semaine 3", "J+1"). */
  date: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type TimelineStep = z.infer<typeof timelineStepSchema>;

export const timelineSchema = z.object({
  steps: z.array(timelineStepSchema).min(2).max(8),
});
export type Timeline = z.infer<typeof timelineSchema>;

/** Type de contenu enrichi détecté pour une slide "diagram" (null = repli liste à puces). */
export const SLIDE_CONTENT_TYPES = ['diagram', 'comparisonTable', 'timeline'] as const;
export const slideContentTypeSchema = z.enum(SLIDE_CONTENT_TYPES);
export type SlideContentType = z.infer<typeof slideContentTypeSchema>;

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
  /**
   * Schéma Mermaid embarqué en texte (template === 'diagram'). Optionnel et
   * additif : rend possible un rendu SVG (mermaid si dispo, sinon repli maison).
   */
  mermaid: mermaidDiagramSchema.optional(),
  /** Tableau de comparaison structuré (template === 'comparison' ou 'diagram'). */
  comparisonTable: comparisonTableSchema.optional(),
  /** Frise chronologique (nouveau gabarit "timeline"). */
  timeline: timelineSchema.optional(),
  /**
   * Lignes du code à mettre en surbrillance progressivement, synchronisées
   * avec la narration (template === 'code'). Chaque entrée = un pas ; les
   * indices de `lines` (0-based) reçoivent la classe .line-active à ce pas.
   * Optionnel : sans cette liste, le code s'affiche sans surbrillance (inchangé).
   */
  codeHighlightSteps: z
    .array(
      z.object({
        lines: z.array(z.number().int().nonnegative()).min(1),
      }),
    )
    .optional(),
  /**
   * Image SDXL PAR SLIDE (Lot 3, plan 2026-07-20) — additif, distincte de
   * l'illustration de leçon existante (une seule, réutilisée par la slide
   * "title"). Champs optionnels : une slide sans ces champs se comporte
   * EXACTEMENT comme avant (motif géométrique par défaut).
   *
   * ⚠️ CRITIQUE (zod strip) : `PATCH /api/lessons/[id]` valide le script
   * entrant avec CE schéma avant de le persister — tout champ de slide non
   * déclaré ici est SILENCIEUSEMENT effacé à la sauvegarde de l'éditeur de
   * script. Ces 5 champs doivent donc vivre ICI, jamais seulement côté
   * worker/UI.
   */
  imageKey: z.string().min(1).optional(),
  /** Prompt éditable par l'auteur (sinon dérivé automatiquement du titre + puces). */
  imagePrompt: z.string().min(1).optional(),
  /** Seed SDXL (reproductibilité) — dérivé de `${lessonId}:${index}` si absent. */
  imageSeed: z.number().int().optional(),
  /** 'generated' (SDXL) ou 'uploaded' (remplacement manuel par l'auteur). */
  imageSource: z.enum(['generated', 'uploaded']).optional(),
  /** Statut de (re)génération — permet au client de suivre une régénération SDXL asynchrone. */
  imageStatus: z.enum(['idle', 'pending', 'ready', 'failed']).optional(),
  /**
   * Moteur ayant produit l'image ACTUELLE de cette slide (audit qualité
   * modèles 2026-07-22, additif) : posé lors d'une régénération explicite via
   * le bouton « essayer l'autre moteur ». Absent = 'sdxl' (défaut historique,
   * comportement inchangé pour toute slide générée avant cet ajout).
   */
  imageEngine: z.enum(['sdxl', 'zimage']).optional(),
  /**
   * Audio manuel PAR SLIDE (Lot 4, plan 2026-07-20) — additif, même logique
   * de zod strip que l'image (ci-dessus) : ces champs doivent vivre ICI.
   * 'tts' (par défaut implicite, absent = comportement inchangé) ou 'manual'
   * (l'auteur a enregistré/uploadé sa propre narration pour cette slide —
   * `tts-generation` copie alors `manualAudioKey` au lieu de resynthétiser,
   * l'enregistrement survit donc à toute régénération de la leçon).
   */
  audioSource: z.enum(['tts', 'manual']).optional(),
  /** Clé S3 du mp3 normalisé (loudnorm -16 LUFS, 48 kHz) issu de l'enregistrement/upload manuel. */
  manualAudioKey: z.string().min(1).optional(),
  /** Statut de la prise manuelle — permet au client de suivre la normalisation asynchrone. */
  audioStatus: z.enum(['idle', 'pending', 'ready', 'failed']).optional(),
});
export type Slide = z.infer<typeof slideSchema>;

/* ------------------------------------------------------------------ */
/* Détection automatique du type de contenu (pure, sans dépendance)    */
/* ------------------------------------------------------------------ */

/**
 * Détecte le type de contenu enrichi d'une slide à partir des champs
 * structurés déjà présents (priorité : mermaid > comparisonTable > timeline)
 * OU, à défaut, d'une détection best-effort sur le texte brut (narration +
 * bullets) pour des scripts produits avant l'ajout de ces champs :
 *  - un bloc mermaid textuel commençant par "flowchart"/"graph" avec des
 *    flèches "-->" est reconnu comme diagramme ;
 *  - des dates en tête de bullets ("2024 — …", "J+1 : …") sont reconnues
 *    comme frise chronologique.
 * Retourne `null` si aucun signal structuré n'est trouvé (repli liste à puces).
 */
export function detectSlideContentType(slide: Slide): SlideContentType | null {
  if (slide.mermaid) return 'diagram';
  if (slide.comparisonTable) return 'comparisonTable';
  if (slide.timeline) return 'timeline';

  // Repli texte : cherche un bloc mermaid dans bullets/notes.
  const haystack = [slide.notes ?? '', ...slide.bullets].join('\n');
  if (isLikelyMermaidSource(haystack)) return 'diagram';

  // Repli texte : au moins 2 bullets commençant par un repère temporel.
  const datedBullets = slide.bullets.filter((b) => TIMELINE_BULLET_RE.test(b.trim()));
  if (datedBullets.length >= 2) return 'timeline';

  return null;
}

/** Repère temporel en tête de ligne : "2024", "J+3", "Semaine 2", "Étape 1", suivi de — ou :. */
const TIMELINE_BULLET_RE = /^(?:\d{4}|J\+\d+|Semaine\s+\d+|Étape\s+\d+|Jour\s+\d+)\s*[—:-]/i;

/** Heuristique légère : texte plausiblement du Mermaid (flowchart/graph + arêtes). */
export function isLikelyMermaidSource(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const hasHeader = /^(flowchart|graph)\s+(TD|TB|LR|RL|BT)/im.test(trimmed);
  const hasEdge = /--?>|--?-/.test(trimmed);
  return hasHeader && hasEdge;
}

/* ------------------------------------------------------------------ */
/* Parseur Mermaid minimal (flowchart) — repli SANS la lib `mermaid`   */
/* ------------------------------------------------------------------ */

/** Nœud extrait d'un flowchart Mermaid. */
export interface MermaidNode {
  readonly id: string;
  readonly label: string;
}
/** Arête orientée extraite d'un flowchart Mermaid. */
export interface MermaidEdge {
  readonly from: string;
  readonly to: string;
  /** Libellé optionnel porté par la flèche (ex. "A -->|oui| B"). */
  readonly label?: string;
}
/** Graphe minimal parsé d'une source Mermaid. */
export interface ParsedMermaidGraph {
  readonly nodes: readonly MermaidNode[];
  readonly edges: readonly MermaidEdge[];
}

/** Extrait id + libellé d'un token de nœud Mermaid : A, A[Texte], A(Texte), A{{Texte}}, A((Texte)). */
const NODE_TOKEN_RE = /^([A-Za-z0-9_-]+)(?:(\[|\(\(|\{\{|\()([^\]}]*?)(?:\]|\)\)|\}\}|\)))?$/;

function parseNodeToken(token: string): MermaidNode {
  const trimmed = token.trim();
  const match = NODE_TOKEN_RE.exec(trimmed);
  if (!match) return { id: trimmed, label: trimmed };
  const id = match[1]!;
  const label = match[3]?.trim() || id;
  return { id, label };
}

/**
 * Parseur volontairement minimal d'un flowchart Mermaid (une ligne = un lien
 * "A --> B", "A -->|libellé| B", ou "A --- B"). Ignore silencieusement les
 * lignes non reconnues (styles, classDef, commentaires %%…) — dégradation
 * gracieuse plutôt qu'un rejet total. Ne remplace PAS mermaid.js : sert
 * uniquement de repli quand la dépendance n'est pas installée (voir
 * apps/worker/src/media/slide-renderer.ts).
 */
export function parseMermaidFlowchart(source: string): ParsedMermaidGraph {
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];

  const lineRe = /^\s*([A-Za-z0-9_-]+(?:\[[^\]]*\]|\(\([^)]*\)\)|\{\{[^}]*\}\}|\([^)]*\))?)\s*(-{1,3}>|-{2,3})(?:\|([^|]*)\|)?\s*([A-Za-z0-9_-]+(?:\[[^\]]*\]|\(\([^)]*\)\)|\{\{[^}]*\}\}|\([^)]*\))?)\s*$/;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^(flowchart|graph)\s/i.test(line)) continue; // en-tête, pas un lien

    const match = lineRe.exec(line);
    if (!match) continue;

    const fromNode = parseNodeToken(match[1]!);
    const toNode = parseNodeToken(match[4]!);
    const edgeLabel = match[3]?.trim();

    nodes.set(fromNode.id, fromNode);
    nodes.set(toNode.id, toNode);
    edges.push({ from: fromNode.id, to: toNode.id, ...(edgeLabel ? { label: edgeLabel } : {}) });
  }

  return { nodes: Array.from(nodes.values()), edges };
}

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

/**
 * Tolérances de parsing (2026-07-28) — les LLM (deepseek, Llama…) produisent
 * systématiquement quelques écarts mécaniques qui faisaient échouer des TP
 * entiers après 3 retries : `value: 500` (nombre naturel pour scroll/wait),
 * champs optionnels envoyés comme chaîne vide, `actions` omis quand `url`
 * suffit, entrées troubleshooting en objet {problème, solution}. On normalise
 * ces formes équivalentes AU LIEU de les rejeter — le contrat sémantique
 * (sélecteurs requis, page de départ, etc.) reste inchangé.
 */
const numberToString = (v: unknown) => (typeof v === 'number' ? String(v) : v);
const emptyToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

/** Action Playwright élémentaire pour rejouer un état d'écran. */
export const tpScreenshotActionSchema = z
  .object({
    type: z.enum(['goto', 'click', 'fill', 'scroll', 'wait']),
    /** Sélecteur CSS ciblé — requis pour click/fill, optionnel pour wait. */
    selector: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    /** Valeur associée : URL pour goto, texte pour fill, pixels pour scroll, ms pour wait. */
    value: z.preprocess(
      (v) => emptyToUndefined(numberToString(v)),
      z.string().min(1).optional(),
    ),
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
    /** Absent ⇒ capture simple de `url` (aucune action à rejouer). */
    actions: z.array(tpScreenshotActionSchema).default([]),
    /** Élément à mettre en évidence sur la capture (annotations D9). */
    focusSelector: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    /** Légende affichée sous la capture dans le TP (repli générique si omise). */
    caption: z.string().min(1).catch("Capture d'écran de l'étape"),
    /**
     * Active le mode screencast (Prompt 85) : au lieu d'une capture image
     * unique, rejoue la spec en enregistrant une vidéo (Playwright
     * recordVideo) avec zoom automatique sur `focusSelector` et narration TTS
     * synchronisée en post-traitement. Absent/false ⇒ comportement historique
     * (capture image simple), aucune régression pour les specs existantes.
     */
    recordVideo: z.boolean().optional(),
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
  command: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  expectedResult: z.string().min(1),
  /** Obligatoire pour toute étape réalisée sur ordinateur (contrat capture P21). */
  screenshotSpec: tpScreenshotSpecSchema.optional(),
});
export type TpStep = z.infer<typeof tpStepSchema>;

/**
 * Entrée de dépannage : chaîne « symptôme → solution ». Certains modèles
 * renvoient un objet {probleme/symptome, solution} — on l'aplatit en chaîne.
 */
const troubleshootingEntrySchema = z.preprocess((v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const parts = Object.values(v as Record<string, unknown>)
      .filter((p): p is string => typeof p === 'string' && p.trim() !== '');
    if (parts.length > 0) return parts.join(' — ');
  }
  return v;
}, z.string().min(1));

/** Contenu complet d'une leçon de type "tp". */
export const tpSchema = z.object({
  objective: z.string().min(1),
  environment: z.array(z.string().min(1)).min(1),
  steps: z.array(tpStepSchema).min(3),
  validation: z.array(z.string().min(1)).min(1),
  troubleshooting: z.array(troubleshootingEntrySchema).min(1),
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

// ── Ressources téléchargeables du cours (Prompt 65) ─────────────
// Générées en fin de pipeline : glossaire des termes clés + liste de
// ressources « pour aller plus loin », produits par Claude à partir du plan
// et des résumés de leçons. Le cheat sheet et le workbook (PDF) réutilisent
// ce même contenu (glossaire → cartes cheatsheet, TPs → sections workbook).

export const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
});
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

export const furtherResourceSchema = z.object({
  title: z.string().min(1),
  /** Type de ressource (article, doc officielle, outil, livre…) — libre, affiché tel quel. */
  kind: z.string().min(1),
  /** URL optionnelle (Claude ne doit inventer que des URLs plausibles/génériques, jamais garanti valide). */
  url: z.string().url().optional(),
  description: z.string().min(1),
});
export type FurtherResource = z.infer<typeof furtherResourceSchema>;

/** Contenu généré par le LLM pour le glossaire + les ressources « pour aller plus loin ». */
export const courseResourcesContentSchema = z.object({
  glossary: z.array(glossaryEntrySchema).min(5).max(40),
  furtherResources: z.array(furtherResourceSchema).min(3).max(20),
});
export type CourseResourcesContent = z.infer<typeof courseResourcesContentSchema>;

// ── Flashcards & répétition espacée (Prompt 203) ────────────────────
/** Une flashcard : recto (question/concept) → verso (réponse/définition). */
export const flashcardSchema = z.object({
  front: z.string().min(1).max(300),
  back: z.string().min(1).max(600),
});
export type Flashcard = z.infer<typeof flashcardSchema>;

/** Jeu de flashcards généré pour un cours (30-80 recommandé). */
export const courseFlashcardsSchema = z.object({
  cards: z.array(flashcardSchema).min(10).max(120),
});
export type CourseFlashcards = z.infer<typeof courseFlashcardsSchema>;

// ── Score de qualité pédagogique (Prompt 94) ────────────────────────
/** Un axe de la rubrique (0 à RUBRIC_MAX_PER_CRITERION points, cf. constants.ts). */
export const qualityRubricSchema = z.object({
  clarity: z.number().min(0).max(25),
  progression: z.number().min(0).max(25),
  examples: z.number().min(0).max(25),
  engagement: z.number().min(0).max(25),
});
export type QualityRubric = z.infer<typeof qualityRubricSchema>;

/** Sortie brute attendue du LLM (ou de l'heuristique mock) — sans horodatage. */
export const qualityEvaluationSchema = z.object({
  score: z.number().min(0).max(100),
  rubric: qualityRubricSchema,
  feedback: z.array(z.string().min(1)).min(1).max(10),
});
export type QualityEvaluation = z.infer<typeof qualityEvaluationSchema>;

/** Score persisté sur Course.qualityScore — évaluation + horodatage d'exécution. */
export const qualityScoreSchema = qualityEvaluationSchema.extend({
  evaluatedAt: z.string(),
});
export type QualityScore = z.infer<typeof qualityScoreSchema>;
