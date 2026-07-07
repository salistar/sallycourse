// Générateur de ressources téléchargeables enrichies (Prompt 65) : en fin de
// pipeline (aux côtés du marketing), produit pour un cours :
//  - un cheat sheet PDF 1 page (gabarit D10 « cheatsheet »)      → glossaire
//  - un workbook PDF avec espaces de réponse (gabarit D10 « workbook ») → TPs
//  - un glossaire structuré + une liste « pour aller plus loin » (JSON)
//    persistés sur Course.resources pour affichage web (téléchargements
//    presignedGetUrl, sans re-générer les PDF à chaque visite).
//
// Le texte (glossaire + ressources) vient de Claude (callClaudeJson, mock-
// friendly). Le contenu du workbook réutilise TEL QUEL les TP déjà générés
// (Lesson.script) : aucun nouvel appel LLM pour les exercices eux-mêmes.
//
// Rendu PDF MOCK-friendly (même pattern que deploy/report.ts) : en mode mock,
// aucun navigateur Playwright n'est lancé, un PDF minimal est archivé.

import {
  Course,
  Lesson,
  PdfTemplate,
  Section,
  escapeHtml,
  getConfig,
  renderPdfTemplate,
  storageKeys,
  uploadObject,
  courseResourcesContentSchema,
  type CheatsheetPdfInput,
  type CheatsheetSection,
  type CourseResourcesContent,
  type ILesson,
  type Locale,
  type TpContent,
  type WorkbookPdfInput,
} from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import type { CostContext } from '../lib/cost.js';
import { logger } from '../queues/index.js';
import { resourcesSystemPrompt, resourcesUserPrompt, type ResourcesPromptInput } from '../prompts/resources.js';

/** Budget de sortie : glossaire + ressources restent un contenu modéré. */
const RESOURCES_MAX_TOKENS = 4096;
/** Nombre maximal d'entrées de glossaire par carte cheatsheet (contrainte du gabarit). */
const GLOSSARY_ITEMS_PER_CARD = 10;

/** Noms de fichiers des ressources dans le bucket (sous storageKeys…resource()). */
export const RESOURCE_FILES = {
  cheatsheet: 'cheatsheet.pdf',
  workbook: 'workbook.pdf',
} as const;

export interface CourseResourcesResult {
  courseId: string;
  cheatsheetKey: string;
  workbookKey: string;
  glossaryTerms: number;
  furtherResources: number;
  /** Nombre de TP inclus dans le workbook (0 → workbook « aucun TP » minimal). */
  workbookSections: number;
}

/* ------------------------------------------------------------------ */
/* Contenu (glossaire + ressources) — appel LLM, mock-friendly          */
/* ------------------------------------------------------------------ */

/**
 * Génère le glossaire + les ressources « pour aller plus loin » d'un cours.
 * Mode mock (MOCK_PROVIDERS ou clé absente) : fixture déterministe locale.
 */
export async function generateResourcesContent(
  input: ResourcesPromptInput,
  cost?: CostContext,
): Promise<CourseResourcesContent> {
  const config = getConfig();
  if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
    const { mockCourseResources } = await import('../lib/mock-fixtures.js');
    logger.debug({ course: input.courseTitle, mock: true }, 'generateResourcesContent : fixture mock déterministe');
    return mockCourseResources(input.courseTitle);
  }

  return callClaudeJson({
    schema: courseResourcesContentSchema,
    system: resourcesSystemPrompt(),
    user: resourcesUserPrompt(input),
    maxTokens: RESOURCES_MAX_TOKENS,
    ...(cost ? { cost } : {}),
  });
}

/** Résumé texte du plan (sections + leçons) injecté dans le prompt Claude. */
export function buildOutlineSummary(
  sections: readonly { _id: unknown; title: string; order: number }[],
  lessons: readonly { title: string; sectionId: unknown; order: number }[],
): string {
  const bySection = new Map<string, string[]>();
  for (const lesson of lessons) {
    const sid = String(lesson.sectionId);
    const bucket = bySection.get(sid) ?? [];
    bucket.push(lesson.title);
    bySection.set(sid, bucket);
  }
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((section, i) => {
      const titles = bySection.get(String(section._id)) ?? [];
      return `${i + 1}. ${section.title}${titles.length > 0 ? ` — ${titles.join(', ')}` : ''}`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Cheat sheet — glossaire → cartes cheatsheet                         */
/* ------------------------------------------------------------------ */

/** Découpe le glossaire en cartes de GLOSSARY_ITEMS_PER_CARD entrées max, tons alternés. */
export function buildCheatsheetSections(
  content: CourseResourcesContent,
): CheatsheetSection[] {
  const tones: CheatsheetSection['tone'][] = ['violet', 'gold', 'info', 'success'];
  const chunks: CourseResourcesContent['glossary'][number][][] = [];
  for (let i = 0; i < content.glossary.length; i += GLOSSARY_ITEMS_PER_CARD) {
    chunks.push(content.glossary.slice(i, i + GLOSSARY_ITEMS_PER_CARD));
  }
  return chunks.map((chunk, i) => ({
    title: chunks.length > 1 ? `Glossaire (${i + 1}/${chunks.length})` : 'Glossaire',
    tone: tones[i % tones.length] ?? 'violet',
    items: chunk.map((entry) => ({ term: entry.term, detail: entry.definition, code: '' })),
  }));
}

/**
 * Rend le cheat sheet en PDF via le gabarit D10 (cheatsheet) et Playwright.
 * En mode mock, retourne un PDF minimal (aucun navigateur lancé).
 */
export async function renderCheatsheetPdf(input: CheatsheetPdfInput, mock = false): Promise<Buffer> {
  const html = renderPdfTemplate(PdfTemplate.Cheatsheet, input);
  if (mock) {
    return Buffer.from(`%PDF-1.4\n% [mock] cheat sheet\n% ${input.courseTitle}\n%%EOF\n`, 'utf-8');
  }
  const { getSlideBrowser } = await import('../media/slide-renderer.js');
  const browser = await getSlideBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Workbook — TP déjà générés → sections avec espaces de réponse        */
/* ------------------------------------------------------------------ */

/** Nombre de lignes de réponse proposées par étape (gabarit : classes lines-N). */
const ANSWER_LINES = 4;

/** Fragment `.wb-section` d'un TP (voir contrat de classes en tête de workbook.html). */
export function tpToWorkbookSectionHtml(index: number, lessonTitle: string, tp: TpContent): string {
  const steps = tp.steps
    .map((step) => {
      const command = step.command
        ? `\n      <pre class="wb-code">${escapeHtml(step.command)}</pre>`
        : '';
      return [
        '    <li class="wb-step">',
        `      <h3>${escapeHtml(step.instruction)}</h3>`,
        `      <p>${escapeHtml(step.expectedResult)}</p>${command}`,
        '    </li>',
      ].join('\n');
    })
    .join('\n');

  const num = String(index).padStart(2, '0');
  return [
    '<section class="wb-section">',
    '  <header class="wb-section-header">',
    `    <span class="wb-section-index">${num}</span>`,
    `    <h2>${escapeHtml(lessonTitle)}</h2>`,
    '  </header>',
    `  <div class="wb-objective">${escapeHtml(tp.objective)}</div>`,
    '  <ol class="wb-steps">',
    steps,
    '  </ol>',
    '  <div class="wb-answer">',
    '    <div class="wb-answer-label">Votre réponse</div>',
    `    <div class="wb-lines lines-${ANSWER_LINES}"></div>`,
    '  </div>',
    `  <div class="wb-tip">${escapeHtml(tp.validation.join(' · '))}</div>`,
    '</section>',
  ].join('\n');
}

/** Construit le fragment `sectionsHtml` complet à partir des leçons TP prêtes. */
export function buildWorkbookSectionsHtml(
  tpLessons: readonly { title: string; script: unknown }[],
): string {
  if (tpLessons.length === 0) {
    return [
      '<section class="wb-section">',
      '  <header class="wb-section-header">',
      '    <span class="wb-section-index">—</span>',
      '    <h2>Aucun TP dans ce cours</h2>',
      '  </header>',
      '  <div class="wb-objective">Ce cours ne comporte pas de travaux pratiques à consigner ici.</div>',
      '</section>',
    ].join('\n');
  }
  return tpLessons
    .map((lesson, i) => tpToWorkbookSectionHtml(i + 1, lesson.title, lesson.script as TpContent))
    .join('\n');
}

/**
 * Rend le workbook en PDF via le gabarit D10 (workbook) et Playwright.
 * En mode mock, retourne un PDF minimal (aucun navigateur lancé).
 */
export async function renderWorkbookPdf(input: WorkbookPdfInput, mock = false): Promise<Buffer> {
  const html = renderPdfTemplate(PdfTemplate.Workbook, input);
  if (mock) {
    return Buffer.from(`%PDF-1.4\n% [mock] workbook\n% ${input.courseTitle}\n%%EOF\n`, 'utf-8');
  }
  const { getSlideBrowser } = await import('../media/slide-renderer.js');
  const browser = await getSlideBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Orchestrateur : contenu + 2 PDF + upload + persistance               */
/* ------------------------------------------------------------------ */

/**
 * Génère l'ensemble des ressources téléchargeables d'un cours et les persiste
 * sur Course.resources : { status:'ready', content, files:{cheatsheetKey,
 * workbookKey}, generatedAt }. Jette en cas d'échec (l'appelant décide si ça
 * doit bloquer la finalisation du cours — best-effort recommandé).
 */
export async function generateCourseResources(params: { courseId: string }): Promise<CourseResourcesResult> {
  const { courseId } = params;
  const config = getConfig();
  const mock = config.MOCK_PROVIDERS === true;

  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);
  const outline = course.outline as { subtitle?: string } | null | undefined;

  const [sections, lessons] = await Promise.all([
    Section.find({ courseId: course._id }).sort({ order: 1 }).lean(),
    Lesson.find({ courseId: course._id }).sort({ order: 1 }).lean<ILesson[]>(),
  ]);

  const outlineSummary = buildOutlineSummary(sections, lessons);

  const content = await generateResourcesContent(
    {
      courseTitle: course.title,
      subtitle: outline?.subtitle,
      difficulty: course.difficulty,
      locale: course.locale,
      outlineSummary,
    },
    { courseId, userId: String(course.userId) },
  );

  const locale: Locale = course.locale;
  const direction = locale === 'ar' ? 'rtl' : 'ltr';

  // ── Cheat sheet (glossaire) ──────────────────────────────────────
  const cheatsheetPdf = await renderCheatsheetPdf(
    {
      lang: locale,
      direction,
      courseTitle: course.title,
      docTitle: 'Aide-mémoire',
      intro: `Récapitulatif des termes clés de « ${course.title} », à garder sous la main pendant vos révisions.`,
      sections: buildCheatsheetSections(content),
    },
    mock,
  );

  // ── Workbook (TPs prêts, avec espaces de réponse) ────────────────
  const tpLessons = lessons
    .filter((l): l is ILesson & { script: TpContent } => l.type === 'tp' && l.status === 'ready' && Boolean(l.script))
    .map((l) => ({ title: l.title, script: l.script }));

  const workbookPdf = await renderWorkbookPdf(
    {
      lang: locale,
      direction,
      courseTitle: course.title,
      docTitle: 'Workbook des travaux pratiques',
      introHtml: `<p>Ce workbook rassemble les travaux pratiques de « ${escapeHtml(course.title)} ». Notez vos réponses au fil des exercices : il vous servira de mémo après le cours.</p>`,
      sectionsHtml: buildWorkbookSectionsHtml(tpLessons),
    },
    mock,
  );

  // ── Upload storage ────────────────────────────────────────────────
  const keys = storageKeys.course(courseId);
  const cheatsheetKey = keys.resource(RESOURCE_FILES.cheatsheet);
  const workbookKey = keys.resource(RESOURCE_FILES.workbook);
  await Promise.all([
    uploadObject(cheatsheetKey, cheatsheetPdf, 'application/pdf'),
    uploadObject(workbookKey, workbookPdf, 'application/pdf'),
  ]);

  // ── Persistance sur le cours ────────────────────────────────────
  await Course.updateOne(
    { _id: courseId },
    {
      $set: {
        resources: {
          status: 'ready',
          content,
          files: { cheatsheetKey, workbookKey },
          generatedAt: new Date(),
        },
      },
    },
  );

  const result: CourseResourcesResult = {
    courseId,
    cheatsheetKey,
    workbookKey,
    glossaryTerms: content.glossary.length,
    furtherResources: content.furtherResources.length,
    workbookSections: tpLessons.length,
  };
  logger.info(result, 'ressources téléchargeables générées et persistées');
  return result;
}
