// Export SCORM 1.2 (Prompt 42). Empaquète un cours en paquet SCORM standard
// importable par tout LMS conforme (Moodle, Blended, TalentLMS…) :
//
//   imsmanifest.xml            (manifeste SCORM 1.2 : organisation + ressources)
//   APIWrapper.js              (pont vers l'API SCORM du LMS — recherche window.API)
//   NN-slug-lecon.html         (une page HTML par leçon : player vidéo + article)
//   quiz-NN-slug-section.html  (quiz interactif : tracking score via API SCORM JS)
//   assets/…                   (vidéos/sous-titres référencés par les leçons)
//
// Ce module est PUR/testable : la génération des XML/HTML n'accède ni au réseau
// ni au stockage. buildScormPackage assemble le ZIP en mémoire (archiver) à
// partir d'un modèle déjà chargé ; le processor/adapter fournit les flux d'assets
// et se charge de l'upload vers storageKeys.course(id).exportFile('scorm.zip').

import { PassThrough, type Readable } from 'node:stream';
import archiver from 'archiver';
import type { ILesson } from '../shared.js';
import { QUIZ } from '../shared.js';
import { markdownToHtml, orderedName, slugify } from '../media/pack.js';

/** Nom du fichier ZIP SCORM dans le bucket (sous exports/). */
export const SCORM_ZIP_FILENAME = 'scorm.zip';

/** Version SCORM ciblée (1.2 : la plus largement supportée par les LMS). */
export const SCORM_VERSION = '1.2';

/* ------------------------------------------------------------------ */
/* Modèle d'entrée                                                     */
/* ------------------------------------------------------------------ */

/** Une question de quiz (sous-ensemble de QuizQuestion utilisé côté SCORM). */
export interface ScormQuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
}

/** Un item SCO du paquet : soit une leçon (article/vidéo), soit un quiz. */
export interface ScormItem {
  /** Identifiant unique de la ressource (item_1, item_2…). */
  id: string;
  /** Titre affiché dans l'arbre de navigation du LMS. */
  title: string;
  /** Chemin HTML relatif dans le ZIP (href de la ressource SCO). */
  href: string;
  /** Contenu HTML complet de la page (déjà rendu, autonome). */
  html: string;
  /** Assets à joindre (clé S3 source → chemin relatif dans le ZIP). */
  assets: ScormAsset[];
}

/** Un asset binaire à empaqueter (vidéo, sous-titres…). */
export interface ScormAsset {
  /** Chemin relatif DANS le ZIP (ex. assets/01/video.mp4). */
  path: string;
  /** Clé S3 source (résolue par le fournisseur de flux au moment du zip). */
  sourceKey: string;
}

/** Modèle de cours minimal nécessaire à la génération SCORM. */
export interface ScormCourseModel {
  courseId: string;
  title: string;
  locale: string;
  sections: { id: string; order: number; title: string }[];
  lessons: ILesson[];
  /** Quiz agrégés par identifiant de section. */
  quizzesBySection: Map<string, ScormQuizQuestion[]>;
}

/* ------------------------------------------------------------------ */
/* Helpers XML/HTML                                                    */
/* ------------------------------------------------------------------ */

/** Échappe un texte pour insertion sûre dans du XML/HTML (attributs inclus). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Direction d'écriture d'après la locale (arabe = rtl). */
function dir(locale: string): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Pont API SCORM 1.2 : localise l'objet `API` exposé par le LMS (fenêtre
 * courante puis parents/opener) et expose des helpers d'initialisation, de
 * remontée de score et de complétion. Inclus tel quel dans chaque page SCO.
 */
export const SCORM_API_WRAPPER_JS = `// APIWrapper — pont SCORM 1.2 minimal (recherche window.API dans la hiérarchie).
(function (global) {
  function findAPI(win) {
    var tries = 0;
    while (win && !win.API && win.parent && win.parent !== win && tries < 500) {
      tries++;
      win = win.parent;
    }
    return win && win.API ? win.API : null;
  }
  function getAPI() {
    var api = findAPI(window);
    if (!api && window.opener) api = findAPI(window.opener);
    return api;
  }
  var API = getAPI();
  var SCORM = {
    available: !!API,
    init: function () {
      if (!API) return false;
      var ok = API.LMSInitialize('') === 'true';
      API.LMSSetValue('cmi.core.lesson_status', 'incomplete');
      API.LMSCommit('');
      return ok;
    },
    setScore: function (raw, min, max) {
      if (!API) return;
      API.LMSSetValue('cmi.core.score.raw', String(raw));
      API.LMSSetValue('cmi.core.score.min', String(min == null ? 0 : min));
      API.LMSSetValue('cmi.core.score.max', String(max == null ? 100 : max));
      API.LMSCommit('');
    },
    complete: function (passed) {
      if (!API) return;
      API.LMSSetValue('cmi.core.lesson_status', passed ? 'passed' : 'completed');
      API.LMSCommit('');
    },
    finish: function () {
      if (!API) return;
      API.LMSFinish('');
    },
  };
  global.SallyScorm = SCORM;
})(window);`;

/**
 * CSS des pages de leçon/quiz exportées (SCORM ET Common Cartridge partagent
 * ce même thème sobre) — centralisé ici pour éviter la duplication littérale
 * (P113) entre scorm.ts et common-cartridge.ts.
 */
export const EXPORT_PAGE_CSS = [
  'body{font-family:system-ui,Segoe UI,sans-serif;line-height:1.65;max-width:820px;margin:2rem auto;padding:0 1.25rem;color:#1a1523}',
  'h1,h2,h3{line-height:1.25}video{width:100%;border-radius:.5rem;background:#000}',
  'pre{background:#1a1523;color:#f4f1fa;padding:1rem;border-radius:.5rem;overflow-x:auto}',
  'blockquote{border-left:3px solid #7c5cff;margin:1.25rem 0;padding:.25rem 1rem;background:#f6f3fb}',
] as const;

/**
 * Enrobe un corps HTML dans un document SCO autonome (initialise l'API SCORM au
 * chargement, la termine au déchargement). Utilisé pour les pages de leçon.
 */
export function scormPageDocument(
  title: string,
  bodyHtml: string,
  locale: string,
  opts: { markComplete?: boolean } = {},
): string {
  const markComplete = opts.markComplete !== false;
  return [
    '<!doctype html>',
    `<html lang="${escapeXml(locale)}" dir="${dir(locale)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeXml(title)}</title>`,
    '<script src="APIWrapper.js"></script>',
    '<style>',
    ...EXPORT_PAGE_CSS,
    '</style>',
    '</head>',
    '<body>',
    `<h1>${escapeXml(title)}</h1>`,
    bodyHtml,
    '<script>',
    'if (window.SallyScorm) { window.SallyScorm.init();',
    markComplete ? 'window.SallyScorm.complete(true);' : '',
    'window.addEventListener("unload", function(){ window.SallyScorm.finish(); }); }',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

/** Rend le corps HTML d'une leçon (player vidéo pour la vidéo, article sinon). */
export function lessonBodyHtml(
  lesson: ILesson,
  videoRelPath: string | null,
  articleMarkdown: string | null,
): string {
  const parts: string[] = [];
  if (lesson.type === 'video' && videoRelPath) {
    parts.push(
      `<video controls preload="metadata" src="${escapeXml(videoRelPath)}"></video>`,
    );
    if (lesson.summary) parts.push(`<p>${escapeXml(lesson.summary)}</p>`);
  } else if (articleMarkdown) {
    parts.push(markdownToHtml(articleMarkdown));
  } else if (lesson.summary) {
    parts.push(`<p>${escapeXml(lesson.summary)}</p>`);
  } else {
    parts.push('<p><em>Contenu de la leçon indisponible.</em></p>');
  }
  return parts.join('\n');
}

/**
 * Page HTML d'un quiz SCORM : rendu des questions + JS de correction qui calcule
 * le score et le remonte au LMS via l'API SCORM (score.raw + lesson_status).
 * Les bonnes réponses sont embarquées côté client (data-answer) — acceptable
 * pour un export auto-hébergé, non pour un examen surveillé.
 */
export function quizPageHtml(
  sectionTitle: string,
  questions: ScormQuizQuestion[],
  locale: string,
): string {
  const valid = questions.filter((q) => q.choices.length >= 2);
  const answers = valid.map((q) => q.correctIndex);
  const blocks = valid
    .map((q, qi) => {
      const choices = q.choices
        .map(
          (c, ci) =>
            `<label class="choice"><input type="radio" name="q${qi}" value="${ci}"> ${escapeXml(c)}</label>`,
        )
        .join('\n');
      const explanation = q.explanation
        ? `<p class="explanation" data-qi="${qi}" hidden>${escapeXml(q.explanation)}</p>`
        : '';
      return `<fieldset class="question"><legend>${qi + 1}. ${escapeXml(q.question)}</legend>${choices}${explanation}</fieldset>`;
    })
    .join('\n');

  const body = [
    `<p>${valid.length} question(s). Répondez puis validez pour enregistrer votre score.</p>`,
    '<form id="quiz">',
    blocks,
    '<button type="submit">Valider le quiz</button>',
    '</form>',
    '<p id="result" role="status" aria-live="polite"></p>',
    '<script>',
    `var ANSWERS = ${JSON.stringify(answers)};`,
    'document.getElementById("quiz").addEventListener("submit", function (e) {',
    '  e.preventDefault();',
    '  var correct = 0;',
    '  for (var i = 0; i < ANSWERS.length; i++) {',
    '    var picked = document.querySelector("input[name=q" + i + "]:checked");',
    '    var exp = document.querySelector(".explanation[data-qi=\\"" + i + "\\"]");',
    '    if (exp) exp.hidden = false;',
    '    if (picked && Number(picked.value) === ANSWERS[i]) correct++;',
    '  }',
    '  var score = ANSWERS.length ? Math.round((correct / ANSWERS.length) * 100) : 0;',
    `  var passed = score >= ${QUIZ.PASSING_SCORE_PERCENT};`,
    '  document.getElementById("result").textContent =',
    '    "Score : " + score + "% (" + correct + "/" + ANSWERS.length + ")" + (passed ? " — réussi" : "");',
    '  if (window.SallyScorm) { window.SallyScorm.setScore(score, 0, 100); window.SallyScorm.complete(passed); }',
    '});',
    '</script>',
  ].join('\n');

  return scormPageDocument(`Quiz — ${sectionTitle}`, body, locale, { markComplete: false });
}

/* ------------------------------------------------------------------ */
/* Manifeste SCORM 1.2                                                 */
/* ------------------------------------------------------------------ */

/**
 * Génère l'imsmanifest.xml SCORM 1.2 : une organisation linéaire, un <item> par
 * SCO, et un <resource> (type webcontent, adlcp:scormtype="sco") listant le
 * fichier HTML + APIWrapper.js + ses assets comme dépendances (<file>).
 */
export function buildImsManifest(model: ScormCourseModel, items: ScormItem[]): string {
  const orgId = 'org_' + slugify(model.title);
  const manifestId = 'manifest_' + model.courseId;

  const itemXml = items
    .map(
      (it) =>
        `      <item identifier="${escapeXml(it.id)}" identifierref="res_${escapeXml(it.id)}">\n` +
        `        <title>${escapeXml(it.title)}</title>\n` +
        `      </item>`,
    )
    .join('\n');

  const resourceXml = items
    .map((it) => {
      const files = [
        `        <file href="${escapeXml(it.href)}"/>`,
        '        <file href="APIWrapper.js"/>',
        ...it.assets.map((a) => `        <file href="${escapeXml(a.path)}"/>`),
      ].join('\n');
      return (
        `    <resource identifier="res_${escapeXml(it.id)}" type="webcontent" ` +
        `adlcp:scormtype="sco" href="${escapeXml(it.href)}">\n` +
        `${files}\n` +
        `    </resource>`
      );
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<manifest identifier="${escapeXml(manifestId)}" version="1.0"`,
    '  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"',
    '  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd',
    '  http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">',
    '  <metadata>',
    '    <schema>ADL SCORM</schema>',
    `    <schemaversion>${SCORM_VERSION}</schemaversion>`,
    '  </metadata>',
    `  <organizations default="${escapeXml(orgId)}">`,
    `    <organization identifier="${escapeXml(orgId)}">`,
    `      <title>${escapeXml(model.title)}</title>`,
    itemXml,
    '    </organization>',
    '  </organizations>',
    '  <resources>',
    resourceXml,
    '  </resources>',
    '</manifest>',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Assemblage des items (pur)                                          */
/* ------------------------------------------------------------------ */

/** Fournit le Markdown d'article et le flux d'un asset à partir d'une clé S3. */
export interface ScormSource {
  /** Lit le Markdown d'un article (null si absent). */
  readArticle(lesson: ILesson): Promise<string | null>;
  /** Indique si une vidéo existe pour cette leçon (et sa clé source). */
  videoKey(lesson: ILesson, sectionOrder: number): Promise<string | null>;
}

/**
 * Construit la liste ordonnée des items SCO (leçons puis quiz de chaque section)
 * avec leur HTML rendu et leurs assets référencés. Logique PURE hormis l'accès
 * au contenu, délégué à `source` (mockable en test).
 */
export async function buildScormItems(
  model: ScormCourseModel,
  source: ScormSource,
): Promise<ScormItem[]> {
  const items: ScormItem[] = [];
  const lessonsBySection = new Map<string, ILesson[]>();
  for (const lesson of model.lessons) {
    const sid = String(lesson.sectionId);
    const bucket = lessonsBySection.get(sid) ?? [];
    bucket.push(lesson);
    lessonsBySection.set(sid, bucket);
  }

  let counter = 0;
  const sections = [...model.sections].sort((a, b) => a.order - b.order);

  for (const section of sections) {
    const sectionLessons = (lessonsBySection.get(section.id) ?? []).sort(
      (a, b) => a.order - b.order,
    );

    for (const lesson of sectionLessons) {
      counter += 1;
      const id = `item_${counter}`;
      const base = orderedName(lesson.order, lesson.title);
      const href = `${base}.html`;
      const assets: ScormAsset[] = [];

      let videoRel: string | null = null;
      const vKey = await source.videoKey(lesson, section.order);
      if (lesson.type === 'video' && vKey) {
        videoRel = `assets/${base}.mp4`;
        assets.push({ path: videoRel, sourceKey: vKey });
      }
      const markdown =
        lesson.type === 'article' ? await source.readArticle(lesson) : null;

      const body = lessonBodyHtml(lesson, videoRel, markdown);
      const html = scormPageDocument(lesson.title, body, model.locale);
      items.push({ id, title: lesson.title, href, html, assets });
    }

    // Quiz de la section (un SCO dédié), s'il existe.
    const quiz = model.quizzesBySection.get(section.id) ?? [];
    const validQuiz = quiz.filter((q) => q.choices.length >= 2);
    if (validQuiz.length > 0) {
      counter += 1;
      const id = `item_${counter}`;
      const href = `quiz-${orderedName(section.order, section.title)}.html`;
      const html = quizPageHtml(section.title, validQuiz, model.locale);
      items.push({ id, title: `Quiz — ${section.title}`, html, href, assets: [] });
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Empaquetage ZIP                                                     */
/* ------------------------------------------------------------------ */

/** Résout un flux binaire pour la clé S3 d'un asset (fourni par le processor). */
export type AssetStreamProvider = (sourceKey: string) => Promise<Readable | null>;

export interface ScormPackResult {
  /** Nombre de SCO (leçons + quiz) écrits dans le paquet. */
  items: number;
  /** Nombre d'assets binaires joints. */
  assets: number;
}

/**
 * Assemble le paquet SCORM (imsmanifest + APIWrapper + pages + assets) et le
 * STREAME vers `sink` (typiquement le PassThrough consommé par uploadObject).
 * L'archive n'est jamais accumulée entièrement en mémoire. `assetStream` fournit
 * les flux binaires ; un asset introuvable est simplement ignoré (log côté appelant).
 */
export async function writeScormPackage(
  model: ScormCourseModel,
  items: ScormItem[],
  sink: PassThrough,
  assetStream: AssetStreamProvider,
): Promise<ScormPackResult> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => sink.destroy(err));
  archive.pipe(sink);

  archive.append(buildImsManifest(model, items), { name: 'imsmanifest.xml' });
  archive.append(SCORM_API_WRAPPER_JS, { name: 'APIWrapper.js' });

  let assetCount = 0;
  for (const item of items) {
    archive.append(item.html, { name: item.href });
    for (const asset of item.assets) {
      const stream = await assetStream(asset.sourceKey);
      if (stream) {
        archive.append(stream, { name: asset.path });
        assetCount += 1;
      }
    }
  }

  await archive.finalize();
  return { items: items.length, assets: assetCount };
}
