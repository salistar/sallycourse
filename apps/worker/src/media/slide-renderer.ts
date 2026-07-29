// Rendu des slides d'une leçon vidéo en PNG 1920×1080 (Prompt 20).
//
// Chaîne : Lesson.script (SlideScript) → pour chaque slide, choix du gabarit
// D7 (@sallycourse/design), construction des données du gabarit, rendu HTML,
// puis capture Playwright (chromium headless, une instance RÉUTILISÉE par
// process) → PNG uploadé dans le stockage objet (courses/…/slides/{i}.png).
// Les clés produites sont écrites dans Lesson.assets.slides[] (ordre du script).
//
// La coloration syntaxique du code reste volontairement simple : shiki n'est
// pas installé, on passe le code brut (échappé) au gabarit « code » qui l'enrobe
// ligne à ligne via son CSS. Voir depsNeeded : « shiki souhaitable ».
//
// L'arabe (Course.locale === 'ar') pilote lang + direction 'rtl' : les gabarits
// gèrent la mise en page miroir et la police adaptée.

import type { Browser } from 'playwright';
import {
  Course,
  SLIDE_IMAGE,
  Lesson,
  Section,
  User,
  RTL_LOCALES,
  VIDEO,
  colors,
  storageKeys,
  uploadObject,
  renderTemplate,
  SlideTemplateEnum,
  detectSlideContentType,
  type SlideTemplateName,
  type SlideTemplateInput,
  type Slide,
  type SlideScript,
  slideScriptSchema,
  themeById,
  type Locale,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { renderMermaidFallbackSvg } from './mermaid-fallback.js';
import { getObjectStream, objectExists } from '../shared.js';
import { generateImageWithEngine, isAnyImageEngineConfigured, type ImageEngine } from './image-generation.js';
import { recordImageCost } from '../lib/cost.js';

/* ------------------------------------------------------------------ */
/* Navigateur partagé (singleton par process)                          */
/* ------------------------------------------------------------------ */

let browserPromise: Promise<Browser> | null = null;

/**
 * Lance (ou réutilise) l'instance chromium headless partagée du process.
 * Réutilisée par le packaging (rendu PDF des solutions de quiz, P30).
 */
export async function getSlideBrowser(): Promise<Browser> {
  return getBrowser();
}

/** Lance (ou réutilise) l'instance chromium headless partagée du process. */
async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  // Import dynamique : évite de charger Playwright quand seul le mapping sert (tests).
  browserPromise = import('playwright').then(({ chromium }) =>
    chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }),
  );
  // Si le lancement échoue, on réarme pour une nouvelle tentative ultérieure.
  browserPromise.catch(() => {
    browserPromise = null;
  });
  return browserPromise;
}

/** Ferme proprement le navigateur partagé (à appeler à l'arrêt du worker). */
export async function closeSlideBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch (err) {
    logger.warn({ err }, 'fermeture du navigateur de slides impossible');
  }
}

/* ------------------------------------------------------------------ */
/* Mapping slide de script → données de gabarit D7                     */
/* ------------------------------------------------------------------ */

/** Contexte commun injecté dans chaque gabarit (footer + localisation). */
export interface SlideRenderContext {
  courseTitle: string;
  locale: Locale;
  lessonLabel: string;
  lessonNumber: number;
  sectionLabel: string;
  sectionNumber: number;
  /** Progression du cours (0–100) affichée dans le pied de page. */
  progress: number;
  /**
   * Illustration SDXL de la leçon (data URI PNG) — affichée sur la slide de
   * titre à la place du motif géométrique. Optionnelle : absente → gabarit
   * inchangé (motif). Chargée/générée par renderLessonSlides (cache S3).
   */
  illustrationDataUri?: string;
}

/** Libellés localisés du kicker « Leçon » / « Partie » selon la locale. */
const LABELS: Record<Locale, { lesson: string; section: string }> = {
  fr: { lesson: 'Leçon', section: 'Partie' },
  en: { lesson: 'Lesson', section: 'Part' },
  ar: { lesson: 'الدرس', section: 'الجزء' },
};

/** Retourne les libellés de kicker pour une locale (repli français). */
export function labelsFor(locale: Locale): { lesson: string; section: string } {
  return LABELS[locale] ?? LABELS.fr;
}

/** Échappe le code pour une injection sûre (le gabarit enrobe ensuite chaque ligne). */
function escapeCode(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Découpe une liste de points en respectant la borne du gabarit (min 1). */
function clampBullets(bullets: string[], max: number, fallback: string): string[] {
  const clean = bullets.map((b) => b.trim()).filter((b) => b.length > 0);
  if (clean.length === 0) return [fallback];
  return clean.slice(0, max);
}

/**
 * Construit les données d'un gabarit D7 pour une slide du script. Pure et
 * déterministe (testable sans navigateur). Le nom de gabarit retourné pilote
 * `renderTemplate`. Les slides « comparison » sans structure gauche/droite
 * exploitable retombent sur « content » (dégradation gracieuse).
 */
export function buildSlideTemplate(
  slide: Slide,
  ctx: SlideRenderContext,
): { name: SlideTemplateName; data: SlideTemplateInput[SlideTemplateName] } {
  const direction: 'ltr' | 'rtl' = RTL_LOCALES.includes(ctx.locale) ? 'rtl' : 'ltr';
  const base = {
    lang: ctx.locale,
    direction,
    courseTitle: ctx.courseTitle,
    progress: ctx.progress,
  };
  const lessonBase = {
    ...base,
    lessonLabel: ctx.lessonLabel,
    lessonNumber: ctx.lessonNumber,
  };
  const title = slide.title.trim() || ctx.courseTitle;

  switch (slide.template) {
    case 'title':
      return {
        name: SlideTemplateEnum.Title,
        data: {
          ...lessonBase,
          title,
          subtitle: slide.bullets[0]?.trim() ?? '',
          ...(ctx.illustrationDataUri ? { illustrationDataUri: ctx.illustrationDataUri } : {}),
        },
      };

    case 'code':
      return {
        name: SlideTemplateEnum.Code,
        data: {
          ...lessonBase,
          title,
          language: slide.language?.trim() || 'text',
          fileName: '',
          // Pas de shiki : code brut échappé, enrobé ligne à ligne par le gabarit.
          // Surbrillance ligne-par-ligne (P83) : voir buildCodeHtmlWithHighlight.
          codeHtml: buildCodeHtmlWithHighlight(slide),
        },
      };

    case 'comparison': {
      // Détection P83 : un tableau structuré (>2 colonnes) prime sur le
      // découpage bullets/2 colonnes historique — rendu par le même gabarit
      // « comparison » en compressant les colonnes excédentaires en items
      // annotés (le gabarit D7 reste limité à 2 colonnes visuelles).
      if (slide.comparisonTable) {
        return buildComparisonTableSlide(slide.comparisonTable, lessonBase, title, ctx.locale);
      }

      const bullets = clampBullets(slide.bullets, 8, title);
      const mid = Math.ceil(bullets.length / 2);
      const left = bullets.slice(0, mid);
      const right = bullets.slice(mid);
      // Sans deux colonnes exploitables, on dégrade proprement en « content ».
      if (right.length === 0) {
        return {
          name: SlideTemplateEnum.Content,
          data: { ...lessonBase, title, bullets: clampBullets(slide.bullets, 5, title) },
        };
      }
      return {
        name: SlideTemplateEnum.Comparison,
        data: {
          ...lessonBase,
          title,
          left: { title: LABELS_COMPARE(ctx.locale).left, items: left.slice(0, 4) },
          right: { title: LABELS_COMPARE(ctx.locale).right, items: right.slice(0, 4) },
        },
      };
    }

    case 'quote':
      return {
        name: SlideTemplateEnum.Quote,
        data: {
          ...base,
          quote: slide.narration.trim() || title,
          author: title,
          role: '',
        },
      };

    case 'diagram': {
      // Détection automatique du type de contenu enrichi (P83) : un schéma
      // Mermaid embarqué ou une frise chronologique priment sur la liste à
      // puces historique. `detectSlideContentType` est pur (shared) ; seule
      // la génération du SVG de repli mermaid vit ici (dépend de node:fs
      // indirectement via parseMermaidFlowchart, aucune I/O réelle).
      const contentType = detectSlideContentType(slide);

      if (contentType === 'timeline' && slide.timeline) {
        return {
          name: SlideTemplateEnum.Timeline,
          data: {
            ...lessonBase,
            title,
            steps: slide.timeline.steps.map((s) => ({
              date: s.date,
              label: s.label,
              description: s.description ?? '',
            })),
          },
        };
      }

      if (contentType === 'comparisonTable' && slide.comparisonTable) {
        return buildComparisonTableSlide(slide.comparisonTable, lessonBase, title, ctx.locale);
      }

      const mermaidSource = slide.mermaid?.source ?? extractMermaidFromText(slide);
      // Sans schéma Mermaid exploitable, le gabarit « diagram » (cadre à
      // coins vides pensé pour un SVG) ne fait qu'afficher 2-3 puces éparses
      // dans un grand cadre vide — visuellement pauvre ET quasi statique
      // (audit ESG 2026-07-19, E3 : le zoom Ken Burns sur un fond uni ne
      // produit presque aucun delta de pixels mesurable, freezedetect signale
      // la slide comme figée). Même dégradation propre que le cas
      // 'comparison' ci-dessus : gabarit « content » (typographie dense,
      // éprouvée visuellement), jamais le cadre vide.
      if (!mermaidSource) {
        return {
          name: SlideTemplateEnum.Content,
          data: { ...lessonBase, title, bullets: clampBullets(slide.bullets, 5, title) },
        };
      }

      return {
        name: SlideTemplateEnum.Diagram,
        data: {
          ...lessonBase,
          title,
          diagramHtml: renderMermaidFallbackSvg(mermaidSource),
          caption: '',
        },
      };
    }

    case 'recap':
      return {
        name: SlideTemplateEnum.Recap,
        data: {
          ...lessonBase,
          title,
          items: clampBullets(slide.bullets, 6, title),
        },
      };

    case 'section-transition':
      return {
        name: SlideTemplateEnum.SectionTransition,
        data: {
          ...base,
          sectionLabel: ctx.sectionLabel,
          sectionNumber: ctx.sectionNumber,
          title,
        },
      };

    case 'content':
    default:
      return {
        name: SlideTemplateEnum.Content,
        data: {
          ...lessonBase,
          title,
          bullets: clampBullets(slide.bullets, 5, title),
        },
      };
  }
}

/** Titres de colonnes localisés du gabarit comparaison. */
function LABELS_COMPARE(locale: Locale): { left: string; right: string } {
  switch (locale) {
    case 'en':
      return { left: 'Before', right: 'After' };
    case 'ar':
      return { left: 'قبل', right: 'بعد' };
    default:
      return { left: 'Avant', right: 'Après' };
  }
}

/**
 * Repli texte (P83) : cherche un bloc Mermoid dans notes/bullets pour les
 * scripts qui n'auraient pas encore le champ structuré `slide.mermaid`.
 * Retourne `undefined` si rien de plausible n'est trouvé.
 */
function extractMermaidFromText(slide: Slide): string | undefined {
  const candidates = [slide.notes ?? '', ...slide.bullets, slide.narration];
  for (const text of candidates) {
    if (/^(flowchart|graph)\s+(TD|TB|LR|RL|BT)/im.test(text.trim())) return text.trim();
  }
  return undefined;
}

/**
 * Construit le gabarit « comparison » à partir d'un tableau structuré (P83) :
 * chaque colonne au-delà des 2 premières est fusionnée dans le texte de
 * l'item (« Col3: valeur ») — le gabarit D7 reste visuellement à 2 colonnes,
 * mais aucune donnée n'est perdue. Dégradation en « content » si le tableau
 * ne fournit qu'une seule colonne exploitable.
 */
function buildComparisonTableSlide(
  table: NonNullable<Slide['comparisonTable']>,
  lessonBase: Record<string, unknown>,
  title: string,
  locale: Locale,
): { name: SlideTemplateName; data: SlideTemplateInput[SlideTemplateName] } {
  const [colA, colB, ...restCols] = table.columns;
  if (!colA) {
    return {
      name: SlideTemplateEnum.Content,
      data: { ...lessonBase, title, bullets: clampBullets([title], 5, title) } as never,
    };
  }
  if (!colB) {
    // Une seule colonne : dégradation en liste à puces "label — valeur".
    const bullets = table.rows.map((r) => `${r.label} — ${r.values[0] ?? ''}`);
    return {
      name: SlideTemplateEnum.Content,
      data: { ...lessonBase, title, bullets: clampBullets(bullets, 5, title) } as never,
    };
  }

  const formatItem = (row: (typeof table.rows)[number], colIndex: number): string => {
    const value = row.values[colIndex] ?? '';
    const extras = restCols
      .map((col, i) => {
        const v = row.values[i + 2];
        return v ? `${col}: ${v}` : '';
      })
      .filter(Boolean)
      .join(' · ');
    return extras ? `${row.label} (${value}) ${extras}` : `${row.label} (${value})`;
  };

  return {
    name: SlideTemplateEnum.Comparison,
    data: {
      ...lessonBase,
      title,
      left: { title: colA, items: table.rows.slice(0, 4).map((r) => formatItem(r, 0)) },
      right: { title: colB, items: table.rows.slice(0, 4).map((r) => formatItem(r, 1)) },
    } as never,
  };
  // `locale` réservé pour une localisation future des libellés de colonnes
  // additionnelles ; non utilisé tant que restCols n'a pas de libellé dédié.
  void locale;
}

/** Mots-clés colorisés par famille de langage (coloration légère, sans dépendance). */
const CODE_KEYWORDS: Record<string, string[]> = {
  python: ['def', 'class', 'import', 'from', 'return', 'if', 'else', 'elif', 'for', 'while', 'try', 'except', 'with', 'as', 'lambda', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'raise', 'pass', 'yield', 'async', 'await'],
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'from', 'export', 'default', 'async', 'await', 'try', 'catch', 'throw', 'new', 'true', 'false', 'null', 'undefined', 'typeof'],
  bash: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'echo', 'export', 'source', 'function', 'sudo', 'cd', 'pip', 'npm', 'python', 'python3'],
  robotframework: ['Library', 'Resource', 'Variables', 'Documentation', 'Suite Setup', 'Suite Teardown', 'Test Setup', 'Test Teardown', 'FOR', 'END', 'IF', 'ELSE', 'Open Browser', 'Close Browser', 'Click Element', 'Input Text', 'Should Be Equal', 'Should Contain', 'Log', 'Sleep', 'Wait Until Element Is Visible'],
  yaml: ['true', 'false', 'null'],
};

/** Alias fréquents → famille de coloration. */
function keywordFamily(language: string | undefined): string[] {
  const lang = (language ?? '').toLowerCase();
  if (/^(py|python)/.test(lang)) return CODE_KEYWORDS.python!;
  if (/^(js|ts|javascript|typescript|node)/.test(lang)) return CODE_KEYWORDS.javascript!;
  if (/^(sh|bash|shell|console|cmd|powershell)/.test(lang)) return CODE_KEYWORDS.bash!;
  if (/robot/.test(lang)) return CODE_KEYWORDS.robotframework!;
  if (/^(yml|yaml)/.test(lang)) return CODE_KEYWORDS.yaml!;
  return [...CODE_KEYWORDS.python!, ...CODE_KEYWORDS.bash!];
}

/**
 * Coloration syntaxique LÉGÈRE d'une ligne DÉJÀ échappée (regex, zéro
 * dépendance — le gabarit design attendait du HTML « pré-colorié » type shiki
 * que personne ne fournissait : les slides code sortaient monochromes).
 * Couleurs = tokens SALISTAR (aucun hex en dur ici).
 */
function highlightLine(escapedLine: string, keywords: string[]): string {
  let line = escapedLine;
  // Commentaires : toute la fin de ligne (# ou //) — colorisée en premier,
  // puis on ne touche plus à ce segment (placeholder).
  let comment = '';
  const commentMatch = line.match(/(#|\/\/).*$/);
  if (commentMatch && !/["'][^"']*(#|\/\/)/.test(line.slice(0, commentMatch.index))) {
    comment = `<span style="color:${colors.neutral[400]};font-style:italic">${commentMatch[0]}</span>`;
    line = line.slice(0, commentMatch.index);
  }
  // Sections Robot Framework : *** Test Cases ***
  line = line.replace(/(\*\*\*[^*]+\*\*\*)/g, `<span style="color:${colors.gold[400]};font-weight:600">$1</span>`);
  // Chaînes entre guillemets (le texte est échappé : les quotes sont intactes).
  line = line.replace(/("[^"]*"|'[^']*')/g, `<span style="color:${colors.success[400]}">$1</span>`);
  // Nombres.
  line = line.replace(/\b(\d+(?:\.\d+)?)\b/g, `<span style="color:${colors.violet[300]}">$1</span>`);
  // Mots-clés (mots entiers, hors spans déjà posés — heuristique simple).
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    line = line.replace(new RegExp(`(?<![\\w>])(${escaped})(?![\\w<])`, 'g'), `<span style="color:${colors.gold[300]};font-weight:600">$1</span>`);
  }
  return line + comment;
}

/**
 * Construit le HTML du code : normalisation des lignes vides (les modèles
 * insèrent souvent une ligne vide entre CHAQUE ligne → interligne géant sur
 * la slide, constaté en rendu réel), coloration légère par ligne, puis
 * surbrillance ligne-par-ligne (P83) si codeHighlightSteps est présent.
 */
function buildCodeHtmlWithHighlight(slide: Slide): string {
  const normalized = (slide.code?.trimEnd() || '// (code)')
    // Lignes vides multiples → une seule ; ligne vide isolée entre deux lignes
    // de code courtes → supprimée (lisibilité slide, pas un éditeur).
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    .replace(/\n[ \t]*\n(?=[ \t]*\S)/g, '\n');
  const keywords = keywordFamily(slide.language);
  const lines = escapeCode(normalized)
    .split('\n')
    .map((l) => highlightLine(l, keywords));

  const steps = slide.codeHighlightSteps;
  const activeLines = new Set(steps?.[steps.length - 1]?.lines ?? []);
  return lines
    .map((line, i) => {
      const content = line === '' ? '&#8203;' : line;
      const cls = activeLines.has(i) ? ' class="line line-active"' : ' class="line"';
      return `<span${cls}>${content}</span>`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Rendu et upload                                                     */
/* ------------------------------------------------------------------ */

export interface RenderLessonSlidesResult {
  courseId: string;
  lessonId: string;
  /** Clés S3 des PNG produits, dans l'ordre du script. */
  slideKeys: string[];
}

/**
 * Rend en PNG toutes les slides du script d'une leçon vidéo et enregistre les
 * clés dans Lesson.assets.slides. Réutilise le navigateur partagé du process
 * (une seule page réutilisée par appel). Jette si la leçon/cours est introuvable
 * ou si le script n'est pas un SlideScript valide.
 */
/** Seed SDXL déterministe dérivé de l'ObjectId hex (même leçon → même image). */
function illustrationSeed(lessonId: string): number {
  const hex = lessonId.replace(/[^0-9a-f]/gi, '').slice(-7) || '1';
  return parseInt(hex, 16) % 2_000_000_000;
}

/**
 * Illustration de la leçon en data URI : servie depuis le cache S3 si déjà
 * générée, sinon générée via Modal (opt-in MODAL_IMAGE/MODAL_ZIMAGE) puis mise
 * en cache. BEST-EFFORT : tout échec (endpoint froid, flag absent…) retourne
 * undefined — la slide de titre garde alors son motif géométrique, jamais
 * d'échec de rendu. `engine` (audit qualité modèles 2026-07-22, additif) :
 * moteur préféré (Course.imageEngine) — absent = SDXL, comportement inchangé.
 */
async function loadOrGenerateIllustration(
  keys: { illustration(): string },
  lessonTitle: string,
  courseTitle: string,
  lessonId: string,
  engine?: ImageEngine,
  /** Contexte de coût (audit 2026-07-26) : instrumente les générations d'images. */
  costCourseId?: string,
): Promise<string | undefined> {
  try {
    const key = keys.illustration();
    if (await objectExists(key)) {
      const chunks: Buffer[] = [];
      for await (const chunk of await getObjectStream(key)) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return `data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`;
    }
    if (!isAnyImageEngineConfigured()) return undefined;
    const { png, provider, validation, durationMs } = await generateImageWithEngine(
      {
        // Anglais : meilleurs résultats. Sans texte (ni SDXL ni Z-Image Turbo
        // ne rendent de texte lisible) — le titre est déjà porté par la typo
        // du gabarit.
        prompt:
          `Modern flat vector illustration for an online course lesson about: ${lessonTitle}. ` +
          `Course topic: ${courseTitle}. Dark background, violet and gold accents, ` +
          `clean professional tech aesthetic, subtle depth, high detail, no text, no words, no letters.`,
        negativePrompt: 'text, words, letters, captions, watermark, logo, blurry, distorted, low quality',
        width: SLIDE_IMAGE.WIDTH,
        height: SLIDE_IMAGE.HEIGHT,
        steps: SLIDE_IMAGE.STEPS,
        seed: illustrationSeed(lessonId),
      },
      engine,
    );
    // Vérification AVANT intégration (2026-07-26) : illustration invalide →
    // motif géométrique conservé (pas d'image cassée dans la vidéo).
    if (!validation.ok) {
      logger.warn({ lessonId, reason: validation.reason }, 'illustration de leçon rejetée à la vérification — motif géométrique conservé');
      return undefined;
    }
    await uploadObject(key, png, 'image/png');
    // Coût image instrumenté avec le moteur réel (audit coûts 2026-07-26).
    if (costCourseId) await recordImageCost({ courseId: costCourseId }, 1, provider, durationMs).catch(() => undefined);
    logger.info({ key, provider }, 'illustration de leçon générée et mise en cache');
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (err) {
    logger.warn({ lessonId, err }, 'illustration indisponible — motif géométrique conservé');
    return undefined;
  }
}

/**
 * Gabarits dont le HTML porte un slot `{{illustrationHtml}}` (Lot 3, plan
 * 2026-07-20) — cf. packages/design/render-templates/{content,recap}.html.
 * "title" a son propre mécanisme, INCHANGÉ (illustration de LEÇON, une seule,
 * chargée une fois avant la boucle ci-dessus) : ne pas le dupliquer ici.
 * "quote"/"timeline" ont volontairement été exclus (compositions centrée/
 * horizontale incompatibles avec un panneau latéral sans refonte visuelle).
 */
const SLIDE_ILLUSTRATION_TEMPLATES: ReadonlySet<SlideTemplateName> = new Set(['content', 'recap']);

/** Seed déterministe PAR SLIDE (leçon + index) — deux slides d'une même leçon n'ont jamais le même seed. */
function slideImageSeed(lessonId: string, index: number): number {
  const hex = lessonId.replace(/[^0-9a-f]/gi, '').slice(-7) || '1';
  // 7919 (nombre premier) : décale suffisamment le seed d'une slide à l'autre
  // pour éviter des images visuellement proches sur des slides consécutives.
  return (parseInt(hex, 16) + index * 7919) % 2_000_000_000;
}

/** Prompt par défaut dérivé du contenu de la slide, si l'auteur n'a pas fourni `slide.imagePrompt`. */
function defaultSlideImagePrompt(slide: Slide, courseTitle: string): string {
  const topic = [slide.title, ...slide.bullets.slice(0, 3)].filter((s) => s.trim()).join(', ');
  return (
    `Modern flat vector illustration for an online course slide about: ${topic || slide.title}. ` +
    `Course topic: ${courseTitle}. Dark background, violet and gold accents, ` +
    `clean professional tech aesthetic, subtle depth, high detail, no text, no words, no letters.`
  );
}

/**
 * Illustration PAR SLIDE (Lot 3) — même mécanique que
 * `loadOrGenerateIllustration` ci-dessus (cache S3 par clé déterministe,
 * best-effort, jamais d'échec de rendu) mais paramétrée par slide : la clé de
 * stockage `slideIllustration(i)` reste TOUJOURS la même que l'image soit
 * générée ici ou uploadée manuellement par l'auteur (routes
 * /slides/[index]/image) — un remplacement manuel écrase donc naturellement
 * le cache et sera servi ici au prochain rendu, sans changement de code.
 * `engine` (audit qualité modèles 2026-07-22, additif) : `slide.imageEngine`
 * si cette slide a été basculée individuellement, sinon `Course.imageEngine` —
 * absent = SDXL, comportement inchangé.
 */
async function loadOrGenerateSlideIllustration(
  key: string,
  prompt: string,
  seed: number,
  engine?: ImageEngine,
  /** Contexte de coût (audit 2026-07-26) : instrumente les générations d'images. */
  costCourseId?: string,
): Promise<string | undefined> {
  try {
    if (await objectExists(key)) {
      const chunks: Buffer[] = [];
      for await (const chunk of await getObjectStream(key)) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return `data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`;
    }
    if (!isAnyImageEngineConfigured()) return undefined;
    const { png, provider, validation, durationMs } = await generateImageWithEngine(
      {
        prompt,
        negativePrompt: 'text, words, letters, captions, watermark, logo, blurry, distorted, low quality',
        width: SLIDE_IMAGE.WIDTH,
        height: SLIDE_IMAGE.HEIGHT,
        steps: SLIDE_IMAGE.STEPS,
        seed,
      },
      engine,
    );
    // Vérification AVANT intégration (2026-07-26) : illustration de slide
    // invalide → motif par défaut conservé.
    if (!validation.ok) {
      logger.warn({ key, reason: validation.reason }, 'illustration de slide rejetée à la vérification — motif par défaut conservé');
      return undefined;
    }
    await uploadObject(key, png, 'image/png');
    // Coût image instrumenté avec le moteur réel (audit coûts 2026-07-26).
    if (costCourseId) await recordImageCost({ courseId: costCourseId }, 1, provider, durationMs).catch(() => undefined);
    logger.info({ key, provider }, 'illustration de slide générée et mise en cache');
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (err) {
    logger.warn({ key, err }, 'illustration de slide indisponible — motif par défaut conservé');
    return undefined;
  }
}

export async function renderLessonSlides(
  courseId: string,
  lessonId: string,
): Promise<RenderLessonSlidesResult> {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  // Préférence d'accessibilité (P137) : gros texte sur les slides si activée
  // par l'auteur du cours. Best-effort — un utilisateur introuvable retombe
  // silencieusement sur le rendu par défaut (comportement inchangé).
  const owner = await User.findById(course.userId).select('preferLargeText').lean();
  const largeText = owner?.preferLargeText === true;
  // Thème visuel du cours (catalogue 2026-07-26) — surcharges :root injectées
  // au rendu ; themeId absent → « salistar » (valeurs identiques aux gabarits).
  const themeVars = themeById(course.themeId).vars;

  const parsed = slideScriptSchema.safeParse(lesson.script);
  if (!parsed.success) {
    throw new Error(
      `renderLessonSlides : Lesson.script invalide (leçon ${lessonId}) — ${parsed.error.issues
        .map((i) => i.message)
        .join(' ; ')}`,
    );
  }
  const script: SlideScript = parsed.data;

  const section = await Section.findById(lesson.sectionId);
  const locale: Locale = course.locale;
  const labels = labelsFor(locale);
  const ctx: SlideRenderContext = {
    courseTitle: course.title,
    locale,
    lessonLabel: labels.lesson,
    lessonNumber: lesson.order + 1,
    sectionLabel: labels.section,
    sectionNumber: (section?.order ?? 0) + 1,
    progress: 0,
  };

  const keys = storageKeys.course(courseId).lesson(ctx.sectionNumber - 1, ctx.lessonNumber - 1);

  // Illustration SDXL de la leçon (best-effort, cache S3) — affichée sur la
  // slide de titre à la place du motif géométrique quand disponible.
  ctx.illustrationDataUri = await loadOrGenerateIllustration(
    keys,
    lesson.title,
    course.title,
    lessonId,
    course.imageEngine,
    courseId,
  );
  const total = script.slides.length;

  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: VIDEO.WIDTH, height: VIDEO.HEIGHT },
    deviceScaleFactor: 1,
  });

  const slideKeys: string[] = [];
  try {
    for (let i = 0; i < total; i++) {
      const slide = script.slides[i]!;
      // Progression cumulée du cours affichée en pied de page (n/N de la leçon).
      const built = buildSlideTemplate(slide, {
        ...ctx,
        progress: Math.round(((i + 1) / total) * 100),
      });

      // Image PAR SLIDE (Lot 3, plan 2026-07-20) — uniquement pour les
      // gabarits qui exposent le slot (cf. SLIDE_ILLUSTRATION_TEMPLATES) ;
      // `buildSlideTemplate` a déjà résolu les dégradations (ex. "comparison"
      // sans structure exploitable → "content"), donc `built.name` reflète le
      // gabarit RÉELLEMENT utilisé, pas `slide.template` brut.
      if (SLIDE_ILLUSTRATION_TEMPLATES.has(built.name)) {
        const imgKey = keys.slideIllustration(i);
        const prompt = slide.imagePrompt?.trim() || defaultSlideImagePrompt(slide, course.title);
        const seed = slide.imageSeed ?? slideImageSeed(lessonId, i);
        const dataUri = await loadOrGenerateSlideIllustration(
          imgKey,
          prompt,
          seed,
          slide.imageEngine ?? course.imageEngine,
          courseId,
        );
        if (dataUri) {
          (built.data as { illustrationDataUri?: string }).illustrationDataUri = dataUri;
        }
      }

      const html = renderTemplate(built.name, built.data as never, { largeText, themeVars });
      await page.setContent(html, { waitUntil: 'networkidle' });
      const png = await page.screenshot({
        type: 'png',
        fullPage: false,
        clip: { x: 0, y: 0, width: VIDEO.WIDTH, height: VIDEO.HEIGHT },
      });

      const key = keys.slide(i);
      await uploadObject(key, png, 'image/png');
      slideKeys.push(key);
    }
  } finally {
    await page.close().catch(() => undefined);
  }

  lesson.assets = lesson.assets ?? { screenshots: [], slides: [] };
  lesson.assets.slides = slideKeys;
  await lesson.save();

  logger.info({ courseId, lessonId, slides: slideKeys.length }, 'slides de leçon rendues et uploadées');
  return { courseId, lessonId, slideKeys };
}

/**
 * Rend la CARTE D'INTRO d'une leçon vidéo en PNG 1920×1080 (gabarit D7 « title »)
 * et retourne le buffer, SANS upload (consommé en tmp par le rendu FFmpeg, P24).
 * Sert d'intro « carte titre » : le rendu motion D8 image-par-image n'est pas
 * requis pour une image tenue. Titre = titre de la leçon ; sous-titre = titre du
 * cours. Réutilise le navigateur partagé du process.
 */
export async function renderIntroCard(courseId: string, lessonId: string): Promise<Buffer> {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  // Préférence d'accessibilité (P137) : voir renderLessonSlides pour le détail.
  const owner = await User.findById(course.userId).select('preferLargeText').lean();
  const largeText = owner?.preferLargeText === true;

  const section = await Section.findById(lesson.sectionId);
  const locale: Locale = course.locale;
  const labels = labelsFor(locale);
  const ctx: SlideRenderContext = {
    courseTitle: course.title,
    locale,
    lessonLabel: labels.lesson,
    lessonNumber: lesson.order + 1,
    sectionLabel: labels.section,
    sectionNumber: (section?.order ?? 0) + 1,
    progress: 0,
  };

  // Slide « title » synthétique : titre de leçon + sous-titre = titre du cours.
  const introSlide: Slide = {
    template: 'title',
    title: lesson.title,
    bullets: [course.title],
    narration: lesson.title,
  };
  const built = buildSlideTemplate(introSlide, ctx);
  const html = renderTemplate(built.name, built.data as never, {
    largeText,
    // Même thème que les slides de la leçon (catalogue 2026-07-26).
    themeVars: themeById(course.themeId).vars,
  });

  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: VIDEO.WIDTH, height: VIDEO.HEIGHT },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    return await page.screenshot({
      type: 'png',
      fullPage: false,
      clip: { x: 0, y: 0, width: VIDEO.WIDTH, height: VIDEO.HEIGHT },
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}
