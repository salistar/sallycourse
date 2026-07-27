/**
 * @sallycourse/design — render-templates.ts
 * Loader typé des gabarits de slides vidéo (packages/design/render-templates/*.html,
 * 1920×1080, rendus par Playwright côté worker).
 *
 * Contrat : renderTemplate(name, data) → HTML complet prêt à charger.
 *  - Validation zod par gabarit (défauts inclus : lang 'fr', direction 'ltr'…).
 *  - Tout texte est échappé ; seuls `codeHtml` (pré-colorié) et `diagramHtml`
 *    (SVG/HTML préparé en amont) sont injectés BRUTS — ne jamais y placer
 *    de contenu utilisateur non assaini.
 *  - Module Node uniquement (node:fs) : à consommer côté worker / serveur,
 *    jamais dans un bundle client.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Gabarits disponibles                                                */
/* ------------------------------------------------------------------ */

/** Énumération des gabarits — objet const (ergonomie enum sans ses pièges TS). */
export const SlideTemplate = {
  Title: 'title',
  Content: 'content',
  Code: 'code',
  Comparison: 'comparison',
  Quote: 'quote',
  Diagram: 'diagram',
  Recap: 'recap',
  SectionTransition: 'section-transition',
  /** Frise chronologique (Prompt 83) — étapes datées réparties sur une ligne. */
  Timeline: 'timeline',
} as const;

export type SlideTemplateName = (typeof SlideTemplate)[keyof typeof SlideTemplate];

/** Liste ordonnée des noms de gabarits (= noms de fichiers .html). */
export const SLIDE_TEMPLATE_NAMES = Object.values(
  SlideTemplate,
) as readonly SlideTemplateName[];

/* ------------------------------------------------------------------ */
/* Schémas zod par gabarit                                             */
/* ------------------------------------------------------------------ */

/** Numéro de leçon/section : nombre (zéro-paddé au rendu) ou libellé libre. */
const numberLike = z.union([z.number().int().nonnegative(), z.string().min(1)]);

/** Champs communs à tous les gabarits (footer + localisation). */
const baseSchema = z.object({
  /** Code langue BCP 47 court ('fr', 'ar', 'en'…) — attribut lang. */
  lang: z.string().min(2).max(12).default('fr'),
  /** Sens de lecture — pilote la mise en page et la police arabe. */
  direction: z.enum(['ltr', 'rtl']).default('ltr'),
  /** Titre du cours affiché dans le pied de page. */
  courseTitle: z.string().min(1),
  /** Progression du cours (0–100), barre + libellé du pied de page. */
  progress: z.number().min(0).max(100).default(0),
});

/** Champs d'en-tête de leçon (kicker « Leçon 04 »). */
const lessonSchema = baseSchema.extend({
  lessonLabel: z.string().min(1).default('Leçon'),
  lessonNumber: numberLike,
});

const titleSchema = lessonSchema.extend({
  title: z.string().min(1),
  subtitle: z.string().default(''),
  /**
   * Illustration générée (SDXL) affichée côté fin de lecture À LA PLACE du
   * motif géométrique — data URI `data:image/png;base64,…` UNIQUEMENT (tout
   * autre schéma est ignoré au rendu : jamais d'URL réseau dans une slide,
   * le rendu Playwright doit rester hermétique). Vide = motif par défaut.
   */
  illustrationDataUri: z.string().default(''),
});

const contentSchema = lessonSchema.extend({
  title: z.string().min(1),
  /** 5 points MAXIMUM — règle de lisibilité du gabarit. */
  bullets: z.array(z.string().min(1)).min(1).max(5),
  /** Image SDXL PAR SLIDE (Lot 3, plan 2026-07-20) — même contrat que titleSchema.illustrationDataUri. */
  illustrationDataUri: z.string().default(''),
});

const codeSchema = lessonSchema.extend({
  title: z.string().min(1),
  /** Badge langage de la barre de fenêtre (ex. 'TypeScript'). */
  language: z.string().min(1),
  /** Nom de fichier affiché au centre de la barre (optionnel). */
  fileName: z.string().default(''),
  /**
   * HTML du code PRÉ-COLORIÉ, injecté brut. Deux formats acceptés :
   * lignes déjà en <span class="line"> (sortie shiki), ou HTML multiligne
   * que le loader découpe par \n et enveloppe ligne à ligne (les balises
   * ne doivent alors pas chevaucher deux lignes).
   */
  codeHtml: z.string().min(1),
});

const comparisonColumnSchema = z.object({
  title: z.string().min(1),
  /** 4 points MAXIMUM par colonne. */
  items: z.array(z.string().min(1)).min(1).max(4),
});

const comparisonSchema = lessonSchema.extend({
  title: z.string().min(1),
  left: comparisonColumnSchema,
  right: comparisonColumnSchema,
});

const quoteSchema = baseSchema.extend({
  quote: z.string().min(1),
  author: z.string().min(1),
  role: z.string().default(''),
});

const diagramSchema = lessonSchema.extend({
  title: z.string().min(1),
  /** SVG/HTML du schéma, préparé en amont, injecté BRUT et centré. */
  diagramHtml: z.string().min(1),
  caption: z.string().default(''),
});

const recapSchema = lessonSchema.extend({
  title: z.string().min(1),
  /** 6 points MAXIMUM — passe en 2 colonnes au-delà de 4. */
  items: z.array(z.string().min(1)).min(1).max(6),
  /** Image SDXL PAR SLIDE (Lot 3, plan 2026-07-20) — même contrat que titleSchema.illustrationDataUri. */
  illustrationDataUri: z.string().default(''),
});

const sectionTransitionSchema = baseSchema.extend({
  sectionLabel: z.string().min(1).default('Partie'),
  sectionNumber: numberLike,
  title: z.string().min(1),
});

/** Une étape de la frise (Prompt 83) — date + libellé, description optionnelle. */
const timelineStepInputSchema = z.object({
  date: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
});

const timelineSchema = lessonSchema.extend({
  title: z.string().min(1),
  /** 6 étapes MAXIMUM — au-delà, la frise devient illisible en 1920px. */
  steps: z.array(timelineStepInputSchema).min(2).max(6),
});

/** Schéma zod de chaque gabarit — exporté pour validation en amont (worker). */
export const slideTemplateSchemas = {
  [SlideTemplate.Title]: titleSchema,
  [SlideTemplate.Content]: contentSchema,
  [SlideTemplate.Code]: codeSchema,
  [SlideTemplate.Comparison]: comparisonSchema,
  [SlideTemplate.Quote]: quoteSchema,
  [SlideTemplate.Diagram]: diagramSchema,
  [SlideTemplate.Recap]: recapSchema,
  [SlideTemplate.SectionTransition]: sectionTransitionSchema,
  [SlideTemplate.Timeline]: timelineSchema,
} as const;

/** Données d'entrée par gabarit (défauts optionnels). */
export type SlideTemplateInput = {
  [K in SlideTemplateName]: z.input<(typeof slideTemplateSchemas)[K]>;
};
/** Données validées par gabarit (défauts résolus). */
export type SlideTemplateData = {
  [K in SlideTemplateName]: z.output<(typeof slideTemplateSchemas)[K]>;
};

export type TitleSlideInput = SlideTemplateInput['title'];
export type ContentSlideInput = SlideTemplateInput['content'];
export type CodeSlideInput = SlideTemplateInput['code'];
export type ComparisonSlideInput = SlideTemplateInput['comparison'];
export type QuoteSlideInput = SlideTemplateInput['quote'];
export type DiagramSlideInput = SlideTemplateInput['diagram'];
export type RecapSlideInput = SlideTemplateInput['recap'];
export type SectionTransitionSlideInput = SlideTemplateInput['section-transition'];
export type TimelineSlideInput = SlideTemplateInput['timeline'];

/* ------------------------------------------------------------------ */
/* Échappement et helpers de fragments                                 */
/* ------------------------------------------------------------------ */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Échappe un texte pour insertion sûre dans le HTML des gabarits. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Formate un numéro : zéro-paddé si nombre (4 → « 04 »), tel quel si texte. */
function formatNumber(value: number | string): string {
  return typeof value === 'number'
    ? String(value).padStart(2, '0')
    : escapeHtml(value);
}

/** Puce losange or du gabarit contenu. */
function bulletFragment(text: string): string {
  return `<li><span class="bullet-diamond" aria-hidden="true"></span><span class="bullet-text">${escapeHtml(text)}</span></li>`;
}

/** Item de colonne du gabarit comparaison. */
function columnItemFragment(text: string): string {
  return `<li><span class="col-diamond" aria-hidden="true"></span><span class="col-item-text">${escapeHtml(text)}</span></li>`;
}

/** Coche or sur pastille violette du gabarit récapitulatif. */
function checklistFragment(text: string): string {
  const check =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M4.5 12.5 10 18 19.5 7" stroke="var(--gold-400)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  return `<li><span class="check">${check}</span><span class="check-text">${escapeHtml(text)}</span></li>`;
}

/** Jalon daté du gabarit frise chronologique (Prompt 83). */
function timelineStepFragment(step: { date: string; label: string; description: string }): string {
  return (
    `<div class="step"><span class="step-dot" aria-hidden="true"></span>` +
    `<span class="step-date">${escapeHtml(step.date)}</span>` +
    `<span class="step-label">${escapeHtml(step.label)}</span>` +
    `<span class="step-description">${escapeHtml(step.description)}</span></div>`
  );
}

/**
 * Normalise le code pré-colorié : si les lignes ne sont pas déjà des
 * <span class="line"> (sortie shiki), découpe par \n et enveloppe chaque
 * ligne (nécessaire aux numéros de ligne CSS du gabarit).
 */
function toCodeLines(codeHtml: string): string {
  if (codeHtml.includes('class="line"')) return codeHtml;
  return codeHtml
    .replace(/\r\n/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `<span class="line">${line === '' ? '&#8203;' : line}</span>`)
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Chargement des fichiers gabarits                                    */
/* ------------------------------------------------------------------ */

const templatesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'render-templates',
);

const templateCache = new Map<SlideTemplateName, string>();

/** Lit (et met en cache) le fichier HTML d'un gabarit. */
function loadTemplate(name: SlideTemplateName): string {
  const cached = templateCache.get(name);
  if (cached !== undefined) return cached;
  const html = readFileSync(join(templatesDir, `${name}.html`), 'utf8');
  templateCache.set(name, html);
  return html;
}

/* ------------------------------------------------------------------ */
/* Construction des valeurs de placeholders                            */
/* ------------------------------------------------------------------ */

type PlaceholderMap = Record<string, string>;

/**
 * Fragment HTML de l'illustration d'une slide. Sécurité : n'accepte QUE les
 * data URI image base64 (regex stricte — aucune URL réseau, aucun HTML
 * arbitraire ne peut être injecté). Vide/invalide → '' (motif géométrique par
 * défaut, masqué par le CSS uniquement quand l'illustration est là).
 * Réutilisé par les gabarits "title", "content" et "recap" (Lot 3, plan
 * 2026-07-20 — image SDXL par slide, pas seulement sur la slide de titre).
 */
function illustrationFragment(dataUri: string): string {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUri)) return '';
  return `<div class="illustration" aria-hidden="true"><img src="${dataUri}" alt=""></div>`;
}

/**
 * Facteur d'échelle du titre de la slide "title" (correctif 1.5, audit
 * 2026-07-20) : à 116px fixe, un titre de cours long (mesuré : « La Due
 * Diligence Environnementale », 34 caractères) débordait de `.hero`
 * (max-width 1240px) et était TRONQUÉ par `overflow:hidden` du gabarit
 * (« La Due Diligence Environnementa »). Le gabarit n'avait aucun mécanisme
 * de fit — contrairement à `fitText` des covers marketing (marketing-assets.ts)
 * — donc un titre trop long ne pouvait QUE déborder, jamais rétrécir. Paliers
 * volontairement simples (longueur de caractères, pas de mesure réelle de
 * largeur de police) : suffisant pour rester dans le gabarit sans mesure
 * Playwright coûteuse par slide.
 */
export function titleFontScale(title: string): number {
  const len = title.trim().length;
  if (len <= 20) return 1;
  if (len <= 30) return 0.85;
  if (len <= 40) return 0.72;
  if (len <= 55) return 0.6;
  return 0.5;
}

/**
 * Facteur de « fit » des puces du gabarit "content" (correctif 2026-07-26).
 * Le gabarit rend les puces à taille FIXE (37px, gap 52px, margin-top 84px)
 * dans un cadre 1920×1080 en `overflow:hidden` : des puces nombreuses ou
 * longues (wrap sur 2-3 lignes) débordent en bas et étaient TRONQUÉES à
 * l'écran (« il manque une partie du texte »). Comme titleFontScale pour le
 * titre, on estime le volume vertical par heuristique (aucune mesure
 * Playwright par slide) et on renvoie un scale ≤ 1 appliqué à la police ET
 * aux espacements via la variable CSS `--fit` (défaut 1 → rendu inchangé).
 * Symétrie assurée : réduire police + gaps préserve les proportions.
 */
export function contentFitScale(
  title: string,
  bullets: readonly string[],
  hasIllustration: boolean,
): number {
  if (bullets.length === 0) return 1;
  // Caractères par ligne estimés (largeur utile réduite quand une
  // illustration occupe la droite : max-width 1020px vs 1480px).
  const bulletCharsPerLine = hasIllustration ? 52 : 78;
  const bulletLines = bullets.reduce(
    (acc, b) => acc + Math.max(1, Math.ceil(b.trim().length / bulletCharsPerLine)),
    0,
  );
  const titleCharsPerLine = hasIllustration ? 30 : 44;
  const titleLines = Math.min(3, Math.max(1, Math.ceil(title.trim().length / titleCharsPerLine)));

  // Budgets verticaux (px) à l'échelle 1, alignés sur content.html.
  const bulletsHeight =
    bulletLines * (37 * 1.45) + Math.max(0, bullets.length - 1) * 52 + 84; // + margin-top
  const titleHeight = titleLines * (64 * 1.15) + 28; // + margin-top
  const available = 1080 - 112 /*top pad*/ - 54 /*kicker*/ - titleHeight - 176 /*bottom pad*/;

  if (bulletsHeight <= available) return 1;
  const scale = available / bulletsHeight;
  return Math.max(0.6, Math.min(1, Number(scale.toFixed(3))));
}

/** Valeurs communes (échappées) : localisation + pied de page. */
function basePlaceholders(data: z.output<typeof baseSchema>): PlaceholderMap {
  return {
    lang: escapeHtml(data.lang),
    direction: data.direction,
    courseTitle: escapeHtml(data.courseTitle),
    progress: String(Math.round(data.progress)),
  };
}

function lessonPlaceholders(data: z.output<typeof lessonSchema>): PlaceholderMap {
  return {
    ...basePlaceholders(data),
    lessonLabel: escapeHtml(data.lessonLabel),
    lessonNumber: formatNumber(data.lessonNumber),
  };
}

/** Construit la table placeholder → valeur finale pour un gabarit donné. */
function buildPlaceholders(
  name: SlideTemplateName,
  data: SlideTemplateData[SlideTemplateName],
): PlaceholderMap {
  switch (name) {
    case SlideTemplate.Title: {
      const d = data as SlideTemplateData['title'];
      return {
        ...lessonPlaceholders(d),
        title: escapeHtml(d.title),
        subtitle: escapeHtml(d.subtitle),
        illustrationHtml: illustrationFragment(d.illustrationDataUri),
        titleScale: String(titleFontScale(d.title)),
      };
    }
    case SlideTemplate.Content: {
      const d = data as SlideTemplateData['content'];
      const illustrationHtml = illustrationFragment(d.illustrationDataUri);
      return {
        ...lessonPlaceholders(d),
        title: escapeHtml(d.title),
        bullets: d.bullets.map(bulletFragment).join('\n      '),
        illustrationHtml,
        // Fit anti-troncature des puces (2026-07-26) : réduit police + gaps
        // quand le volume de texte déborderait le cadre 1080px.
        fitScale: String(contentFitScale(d.title, d.bullets, illustrationHtml !== '')),
      };
    }
    case SlideTemplate.Code: {
      const d = data as SlideTemplateData['code'];
      return {
        ...lessonPlaceholders(d),
        title: escapeHtml(d.title),
        language: escapeHtml(d.language),
        fileName: escapeHtml(d.fileName),
        codeHtml: toCodeLines(d.codeHtml), // injecté brut (pré-colorié)
      };
    }
    case SlideTemplate.Comparison: {
      const d = data as SlideTemplateData['comparison'];
      return {
        ...lessonPlaceholders(d),
        title: escapeHtml(d.title),
        leftTitle: escapeHtml(d.left.title),
        rightTitle: escapeHtml(d.right.title),
        leftItems: d.left.items.map(columnItemFragment).join('\n          '),
        rightItems: d.right.items.map(columnItemFragment).join('\n          '),
      };
    }
    case SlideTemplate.Quote: {
      const d = data as SlideTemplateData['quote'];
      return {
        ...basePlaceholders(d),
        quote: escapeHtml(d.quote),
        author: escapeHtml(d.author),
        role: escapeHtml(d.role),
      };
    }
    case SlideTemplate.Diagram: {
      const d = data as SlideTemplateData['diagram'];
      return {
        ...lessonPlaceholders(d),
        title: escapeHtml(d.title),
        diagramHtml: d.diagramHtml, // injecté brut (SVG/HTML préparé)
        caption: escapeHtml(d.caption),
      };
    }
    case SlideTemplate.Recap: {
      const d = data as SlideTemplateData['recap'];
      return {
        ...lessonPlaceholders(d),
        title: escapeHtml(d.title),
        items: d.items.map(checklistFragment).join('\n      '),
        // Au-delà de 4 points : passage en grille 2 colonnes
        checklistLayout: d.items.length > 4 ? ' two-cols' : '',
        illustrationHtml: illustrationFragment(d.illustrationDataUri),
      };
    }
    case SlideTemplate.SectionTransition: {
      const d = data as SlideTemplateData['section-transition'];
      return {
        ...basePlaceholders(d),
        sectionLabel: escapeHtml(d.sectionLabel),
        sectionNumber: formatNumber(d.sectionNumber),
        title: escapeHtml(d.title),
      };
    }
    case SlideTemplate.Timeline: {
      const d = data as SlideTemplateData['timeline'];
      return {
        ...lessonPlaceholders(d),
        title: escapeHtml(d.title),
        steps: d.steps.map(timelineStepFragment).join('\n      '),
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* API publique                                                        */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_RE = /\{\{([\w-]+)\}\}/g;

/**
 * Facteur d'agrandissement appliqué au texte de contenu (titre, puces, code,
 * citation, checklist, frise…) quand `largeText` est demandé (Prompt 137,
 * préférence User.preferLargeText). Modéré : lisibilité accrue sans casser
 * la mise en page des gabarits 1920×1080 (wrap 2 lignes, hauteurs fixes).
 */
export const LARGE_TEXT_SCALE = 1.12;

/** Options de rendu communes à tous les gabarits (Prompt 137). */
export interface RenderTemplateOptions {
  /**
   * Si true, augmente la taille de police du texte de contenu (variable CSS
   * `--text-scale`, consommée par les gabarits via `calc(Npx * var(--text-scale))`).
   * Défaut false (comportement inchangé).
   */
  largeText?: boolean;
  /**
   * Thème visuel (catalogue de thèmes 2026-07-26) : surcharges de variables
   * CSS `:root` injectées avant `</head>` — même mécanisme que `--text-scale`.
   * Absent/objet vide → rendu strictement identique à avant (le défaut
   * `salistar` reproduit les valeurs figées des gabarits).
   */
  themeVars?: Record<string, string>;
}

/** Injecte des overrides `:root{…}` juste avant la fermeture du `</head>`. */
function injectRootOverride(html: string, declarations: string): string {
  if (!declarations) return html;
  const override = `<style>:root{${declarations}}</style>`;
  const closeHeadIndex = html.indexOf('</head>');
  if (closeHeadIndex === -1) return html + override;
  return `${html.slice(0, closeHeadIndex)}${override}${html.slice(closeHeadIndex)}`;
}

/** Injecte l'override `--text-scale` + les variables de thème éventuelles. */
function applyRenderOptions(html: string, options: RenderTemplateOptions | undefined): string {
  let declarations = '';
  if (options?.themeVars) {
    declarations += Object.entries(options.themeVars)
      .filter(([k]) => k.startsWith('--'))
      .map(([k, v]) => `${k}:${v};`)
      .join('');
  }
  if (options?.largeText) {
    declarations += `--text-scale:${LARGE_TEXT_SCALE};`;
  }
  return injectRootOverride(html, declarations);
}

/**
 * Rend un gabarit de slide : valide `data` (zod), substitue les moustaches
 * et retourne le document HTML 1920×1080 prêt pour Playwright.
 * Lève une erreur explicite si les données sont invalides, si un placeholder
 * du gabarit n'a pas de valeur, ou si le fichier gabarit est introuvable.
 * `options.largeText` (P137) augmente la taille du texte de contenu — additif,
 * absent/false → rendu strictement identique à avant.
 */
export function renderTemplate<N extends SlideTemplateName>(
  name: N,
  data: SlideTemplateInput[N],
  options?: RenderTemplateOptions,
): string {
  const schema = slideTemplateSchemas[name];
  if (schema === undefined) {
    throw new Error(
      `renderTemplate : gabarit inconnu « ${String(name)} » (attendu : ${SLIDE_TEMPLATE_NAMES.join(', ')})`,
    );
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join(' ; ');
    throw new Error(`renderTemplate("${name}") : données invalides — ${details}`);
  }

  const placeholders = buildPlaceholders(
    name,
    parsed.data as SlideTemplateData[SlideTemplateName],
  );

  const html = loadTemplate(name).replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = placeholders[key];
    if (value === undefined) {
      throw new Error(
        `renderTemplate("${name}") : placeholder ${match} sans valeur — gabarit et loader désynchronisés`,
      );
    }
    return value;
  });

  return applyRenderOptions(html, options);
}
