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
  Lesson,
  Section,
  User,
  RTL_LOCALES,
  VIDEO,
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
  type Locale,
} from '../shared.js';
import { logger } from '../queues/index.js';
import { renderMermaidFallbackSvg } from './mermaid-fallback.js';

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
      const diagramHtml = mermaidSource
        ? renderMermaidFallbackSvg(mermaidSource)
        : diagramFromBullets(slide.bullets, title);

      return {
        name: SlideTemplateEnum.Diagram,
        data: {
          ...lessonBase,
          title,
          diagramHtml,
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

/** Fragment HTML minimal pour le gabarit « diagram » à partir de points. */
function diagramFromBullets(bullets: string[], title: string): string {
  const items = bullets.map((b) => b.trim()).filter((b) => b.length > 0);
  const list = (items.length > 0 ? items : [title])
    .map((b) => `<li>${escapeCode(b)}</li>`)
    .join('');
  return `<ul class="diagram-flow">${list}</ul>`;
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

/**
 * Construit le HTML du code avec surbrillance ligne-par-ligne (P83).
 * Sans `codeHighlightSteps`, comportement inchangé (aucune ligne .line-active).
 * Avec, la DERNIÈRE étape définit l'état final affiché sur la slide statique
 * (rendu PNG unique — pas de balayage temporel ici, réservé au futur rendu
 * vidéo image-par-image façon D8, cf. header du fichier code.html).
 */
function buildCodeHtmlWithHighlight(slide: Slide): string {
  const escaped = escapeCode(slide.code?.trimEnd() || '// (code)');
  const steps = slide.codeHighlightSteps;
  if (!steps || steps.length === 0) return escaped;

  const activeLines = new Set(steps[steps.length - 1]?.lines ?? []);
  if (activeLines.size === 0) return escaped;

  const lines = escaped.split('\n');
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

      const html = renderTemplate(built.name, built.data as never, { largeText });
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
  const html = renderTemplate(built.name, built.data as never, { largeText });

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
