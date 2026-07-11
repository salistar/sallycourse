// Export IMS Common Cartridge 1.3 (Prompt 101) — format d'échange standard
// utilisé pour l'import manuel dans Coursera/edX Studio (partenaires
// institutionnels uniquement, aucune API d'auto-publication publique). Un
// .imscc est un ZIP contenant :
//
//   imsmanifest.xml   (organizations/items + resources, référence les pages)
//   NN-slug-lecon.html (une page HTML par leçon : article ou renvoi vidéo)
//   quiz-NN-slug.xml   (bloc QTI simplifié embarqué en resource webcontent)
//   assets/…           (vidéos référencées par les leçons, si présentes)
//
// Module PUR/testable : aucune I/O réseau ni stockage. buildCommonCartridge
// assemble le ZIP EN MÉMOIRE (archiver → Buffer) à partir d'un modèle déjà
// chargé ; l'adapter fournit les flux d'assets et gère l'upload vers
// storageKeys.course(id).exportFile('common-cartridge.imscc').

import archiver from 'archiver';
import type { ILesson } from '../shared.js';
import { markdownToHtml, orderedName, slugify } from '../media/pack.js';
import { escapeXml, EXPORT_PAGE_CSS } from './scorm.js';

/** Nom du fichier .imscc dans le bucket (sous exports/). */
export const COMMON_CARTRIDGE_FILENAME = 'common-cartridge.imscc';

/** Version IMS Common Cartridge ciblée (1.3 : supportée par Coursera/edX Studio). */
export const COMMON_CARTRIDGE_VERSION = '1.3.0';

/* ------------------------------------------------------------------ */
/* Modèle d'entrée                                                     */
/* ------------------------------------------------------------------ */

/** Une question de quiz (sous-ensemble utilisé côté export). */
export interface CartridgeQuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
}

/** Modèle de cours minimal nécessaire à la génération Common Cartridge. */
export interface CartridgeCourseModel {
  courseId: string;
  title: string;
  locale: string;
  sections: { id: string; order: number; title: string }[];
  lessons: ILesson[];
  /** Quiz agrégés par identifiant de section. */
  quizzesBySection: Map<string, CartridgeQuizQuestion[]>;
}

/** Un item du cartridge : soit une leçon (article/vidéo), soit un quiz. */
export interface CartridgeItem {
  /** Identifiant unique de la ressource (item_1, item_2…). */
  id: string;
  /** Titre affiché dans la table des matières du LMS cible. */
  title: string;
  /** Chemin relatif dans le ZIP (href de la ressource). */
  href: string;
  /** Contenu (HTML pour une leçon, XML QTI-like pour un quiz). */
  content: string;
  /** Type MIME du contenu référencé (webcontent HTML ou QTI). */
  kind: 'webcontent' | 'qti';
  /** Assets à joindre (chemin relatif dans le ZIP → clé source). */
  assets: CartridgeAsset[];
}

/** Un asset binaire à empaqueter (vidéo). */
export interface CartridgeAsset {
  /** Chemin relatif DANS le ZIP (ex. assets/01/video.mp4). */
  path: string;
  /** Clé source (résolue par le fournisseur de flux au moment du zip). */
  sourceKey: string;
}

/* ------------------------------------------------------------------ */
/* Helpers HTML — page de leçon autonome (pas d'API LMS, contrairement */
/* au SCORM : Common Cartridge ne prévoit pas de suivi de progression) */
/* ------------------------------------------------------------------ */

/** Direction d'écriture d'après la locale (arabe = rtl). */
function dir(locale: string): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Enrobe un corps HTML dans une page autonome (sans dépendance API LMS). */
export function cartridgePageDocument(title: string, bodyHtml: string, locale: string): string {
  return [
    '<!doctype html>',
    `<html lang="${escapeXml(locale)}" dir="${dir(locale)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeXml(title)}</title>`,
    '<style>',
    ...EXPORT_PAGE_CSS,
    '</style>',
    '</head>',
    '<body>',
    `<h1>${escapeXml(title)}</h1>`,
    bodyHtml,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Rend le corps HTML d'une leçon (player vidéo pour la vidéo, article sinon). */
export function cartridgeLessonBodyHtml(
  lesson: ILesson,
  videoRelPath: string | null,
  articleMarkdown: string | null,
): string {
  const parts: string[] = [];
  if (lesson.type === 'video' && videoRelPath) {
    parts.push(`<video controls preload="metadata" src="${escapeXml(videoRelPath)}"></video>`);
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
 * Bloc quiz au format QTI simplifié (IMS QTI v1.2, sous-ensemble suffisant pour
 * l'import Coursera/edX Studio en tant que « practice quiz »). Un
 * <assessment> avec un <item> par question, choix multiples, réponse correcte
 * marquée par <respcondition>. Pas de logique client (contrairement au SCORM) :
 * l'évaluation/le tracking sont gérés par le LMS cible après import.
 */
export function cartridgeQuizQti(
  sectionTitle: string,
  questions: CartridgeQuizQuestion[],
  ident: string,
): string {
  const valid = questions.filter((q) => q.choices.length >= 2);
  const itemsXml = valid
    .map((q, qi) => {
      const itemIdent = `${ident}_q${qi + 1}`;
      const choicesXml = q.choices
        .map(
          (c, ci) =>
            `          <response_label ident="choice_${ci}"><material><mattext texttype="text/plain">${escapeXml(c)}</mattext></material></response_label>`,
        )
        .join('\n');
      const correctIdent = `choice_${q.correctIndex}`;
      const explanation = q.explanation
        ? `\n        <itemfeedback ident="correct_fb"><flow_mat><material><mattext texttype="text/html">${escapeXml(q.explanation)}</mattext></material></flow_mat></itemfeedback>`
        : '';
      return [
        `      <item ident="${escapeXml(itemIdent)}" title="${escapeXml(q.question)}">`,
        '        <presentation>',
        `          <material><mattext texttype="text/plain">${escapeXml(q.question)}</mattext></material>`,
        '          <response_lid ident="response1" rcardinality="Single">',
        '            <render_choice>',
        choicesXml,
        '            </render_choice>',
        '          </response_lid>',
        '        </presentation>',
        '        <resprocessing>',
        '          <outcomes><decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100"/></outcomes>',
        `          <respcondition continue="No"><conditionvar><varequal respident="response1">${escapeXml(correctIdent)}</varequal></conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition>`,
        '        </resprocessing>' + explanation,
        '      </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 ims_qtiasiv1p2p1.xsd">',
    `  <assessment ident="${escapeXml(ident)}" title="${escapeXml(`Quiz — ${sectionTitle}`)}">`,
    '    <section ident="root_section">',
    itemsXml,
    '    </section>',
    '  </assessment>',
    '</questestinterop>',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Manifeste IMS Common Cartridge 1.3                                  */
/* ------------------------------------------------------------------ */

/**
 * Génère l'imsmanifest.xml IMS CC 1.3 : une organisation linéaire, un <item>
 * par ressource, et un <resource> par item (webcontent pour les leçons,
 * imswl_xmlv1p3/QTI pour les quiz) référençant son fichier + ses assets.
 */
export function buildCommonCartridgeManifest(
  model: CartridgeCourseModel,
  items: CartridgeItem[],
): string {
  const orgId = 'org_' + slugify(model.title);
  const manifestId = 'manifest_' + slugify(model.courseId || model.title);

  const itemXml = items
    .map(
      (it) =>
        `      <item identifier="item_ref_${escapeXml(it.id)}" identifierref="res_${escapeXml(it.id)}">\n` +
        `        <title>${escapeXml(it.title)}</title>\n` +
        `      </item>`,
    )
    .join('\n');

  const resourceXml = items
    .map((it) => {
      const type = it.kind === 'qti' ? 'imsqti_xmlv1p2/imscc_xmlv1p1/assessment' : 'webcontent';
      const files = [
        `        <file href="${escapeXml(it.href)}"/>`,
        ...it.assets.map((a) => `        <file href="${escapeXml(a.path)}"/>`),
      ].join('\n');
      return (
        `    <resource identifier="res_${escapeXml(it.id)}" type="${type}" ` +
        `href="${escapeXml(it.href)}">\n` +
        `${files}\n` +
        `    </resource>`
      );
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<manifest identifier="${escapeXml(manifestId)}"`,
    '  xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1"',
    '  xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p3/LOM/resource"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1 ccv1p3_imscp_v1p2_v1p0.xsd">',
    '  <metadata>',
    '    <schema>IMS Common Cartridge</schema>',
    `    <schemaversion>${COMMON_CARTRIDGE_VERSION}</schemaversion>`,
    '    <lom:lom>',
    '      <lom:general>',
    `        <lom:title><lom:string>${escapeXml(model.title)}</lom:string></lom:title>`,
    '      </lom:general>',
    '    </lom:lom>',
    '  </metadata>',
    `  <organizations>`,
    `    <organization identifier="${escapeXml(orgId)}" structure="rooted-hierarchy">`,
    '      <item identifier="root_item">',
    itemXml,
    '      </item>',
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

/** Fournit le Markdown d'article et la clé vidéo d'une leçon. */
export interface CartridgeSource {
  /** Lit le Markdown d'un article (null si absent). */
  readArticle(lesson: ILesson): Promise<string | null>;
  /** Indique si une vidéo existe pour cette leçon (et sa clé source). */
  videoKey(lesson: ILesson, sectionOrder: number): Promise<string | null>;
}

/**
 * Construit la liste ordonnée des items (leçons puis quiz de chaque section)
 * avec leur contenu rendu et leurs assets référencés. Logique PURE hormis
 * l'accès au contenu, délégué à `source` (mockable en test).
 */
export async function buildCartridgeItems(
  model: CartridgeCourseModel,
  source: CartridgeSource,
): Promise<CartridgeItem[]> {
  const items: CartridgeItem[] = [];
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
      const assets: CartridgeAsset[] = [];

      let videoRel: string | null = null;
      const vKey = await source.videoKey(lesson, section.order);
      if (lesson.type === 'video' && vKey) {
        videoRel = `assets/${base}.mp4`;
        assets.push({ path: videoRel, sourceKey: vKey });
      }
      const markdown = lesson.type === 'article' ? await source.readArticle(lesson) : null;

      const body = cartridgeLessonBodyHtml(lesson, videoRel, markdown);
      const html = cartridgePageDocument(lesson.title, body, model.locale);
      items.push({ id, title: lesson.title, href, content: html, kind: 'webcontent', assets });
    }

    // Quiz de la section (une ressource QTI dédiée), s'il existe.
    const quiz = model.quizzesBySection.get(section.id) ?? [];
    const validQuiz = quiz.filter((q) => q.choices.length >= 2);
    if (validQuiz.length > 0) {
      counter += 1;
      const id = `item_${counter}`;
      const base = `quiz-${orderedName(section.order, section.title)}`;
      const href = `${base}.xml`;
      const ident = `assessment_${slugify(section.title)}`;
      const xml = cartridgeQuizQti(section.title, validQuiz, ident);
      items.push({
        id,
        title: `Quiz — ${section.title}`,
        href,
        content: xml,
        kind: 'qti',
        assets: [],
      });
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Empaquetage ZIP (Buffer, en mémoire)                                */
/* ------------------------------------------------------------------ */

/** Résout un flux binaire pour la clé source d'un asset (fourni par l'appelant). */
export type CartridgeAssetProvider = (sourceKey: string) => Promise<Buffer | null>;

export interface CartridgePackResult {
  /** Buffer ZIP complet (.imscc), prêt à uploader. */
  buffer: Buffer;
  /** Nombre d'items (leçons + quiz) écrits dans le paquet. */
  items: number;
  /** Nombre d'assets binaires joints. */
  assets: number;
}

/**
 * Assemble le paquet Common Cartridge (imsmanifest + pages + quiz + assets)
 * ENTIÈREMENT EN MÉMOIRE et retourne son Buffer ZIP. Adapté à la taille d'un
 * export (pas de streaming disque) — cohérent avec l'usage manuel/ponctuel de
 * cet adapter (aucune automatisation de haut débit requise).
 */
export async function buildCommonCartridge(
  model: CartridgeCourseModel,
  items: CartridgeItem[],
  assetProvider: CartridgeAssetProvider = async () => null,
): Promise<CartridgePackResult> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  const done = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', resolve);
  });

  archive.append(buildCommonCartridgeManifest(model, items), { name: 'imsmanifest.xml' });

  let assetCount = 0;
  for (const item of items) {
    archive.append(item.content, { name: item.href });
    for (const asset of item.assets) {
      const data = await assetProvider(asset.sourceKey);
      if (data) {
        archive.append(data, { name: asset.path });
        assetCount += 1;
      }
    }
  }

  await archive.finalize();
  await done;

  return { buffer: Buffer.concat(chunks), items: items.length, assets: assetCount };
}
