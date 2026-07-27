// Générateur d'EBOOK (Prompt 201) : compile le cours en un livre — articles
// (Markdown déjà généré) + transcriptions des vidéos (narration des slides, déjà
// en prose) — et produit DEUX sorties, sans nouvel appel LLM :
//   - EPUB (zip conforme : mimetype STORED en 1er, container.xml, content.opf,
//     toc.ncx, un XHTML par section) → Kindle/Google Books/liseuses,
//   - PDF « print-ready » (rendu Playwright, même pattern que resources.ts).
// Best-effort : un échec n'invalide jamais la finalisation du cours.
import archiver from 'archiver';
import {
  Course,
  Lesson,
  Section,
  escapeHtml,
  getConfig,
  getObjectStream,
  objectExists,
  slideScriptSchema,
  storageKeys,
  uploadObject,
} from '../shared.js';
import { markdownToHtml } from '../media/pack.js';
import { logger } from '../queues/index.js';

/**
 * Référence à une image Markdown d'un chapitre (correctif 1.7, audit
 * 2026-07-20) : `key` est la clé de stockage résolue (absente si le chemin
 * Markdown n'a pas pu être résolu), `token` le jeton unique inséré dans le
 * HTML à la place de l'image d'origine, `caption` le texte de repli si
 * l'image ne peut être embarquée (téléchargement en échec, chemin illisible).
 */
export interface EbookImageRef {
  token: string;
  key?: string;
  caption: string;
}

/** Un chapitre du livre = une section du cours. */
export interface EbookChapter {
  title: string;
  /** Contenu HTML du chapitre (leçons concaténées) — contient des jetons `images[].token` à la place des images. */
  html: string;
  /** Images référencées par le chapitre, dans l'ordre d'apparition. Additif — absent = aucune image. */
  images?: EbookImageRef[];
}

/** Préfixe des jetons d'image insérés dans le HTML (peu de risque de collision avec du contenu réel). */
const IMG_TOKEN_PREFIX = 'SALLYCOURSE_EBOOK_IMG_';

/**
 * Extrait les images Markdown d'un article et les remplace par un jeton isolé
 * (son propre paragraphe, jamais mêlé au texte environnant — cf. commentaire
 * de `embedChapterImages`). Résout le chemin relatif (`./sections/…/screenshots/0.png`)
 * en clé de stockage absolue (`courses/{courseId}/sections/…`). PURE — la
 * résolution du CONTENU (téléchargement du PNG) est faite séparément par
 * l'appelant, en I/O, une seule fois par clé pour tout l'ebook (PDF + EPUB).
 *
 * Avant ce correctif (`stripMarkdownImages`), toute image était retirée sans
 * jamais être embarquée : 12 légendes « Figure : … » se retrouvaient sans
 * AUCUNE image dans le PDF ET l'EPUB (audit 2026-07-20). `nextIndex` est un
 * compteur PARTAGÉ entre tous les chapitres d'un même ebook — les jetons
 * doivent rester uniques sur tout le document PDF concaténé, pas seulement
 * au sein d'un chapitre.
 */
export function tokenizeMarkdownImages(
  markdown: string,
  courseId: string,
  nextIndex: () => number,
): { markdown: string; images: EbookImageRef[] } {
  const images: EbookImageRef[] = [];
  const coursePrefix = storageKeys.course(courseId).prefix;
  const out = markdown.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_m, alt: string, rawPath: string) => {
    const caption = alt.trim();
    const token = `${IMG_TOKEN_PREFIX}${nextIndex()}`;
    const rel = rawPath.trim().replace(/^\.\//, '');
    const key = rel ? `${coursePrefix}/${rel}` : undefined;
    images.push({ token, key, caption });
    // Isolé sur sa propre "ligne" (lignes vides autour) : markdownToHtml en
    // fera un <p>{token}</p> à part entière, jamais mêlé au texte adjacent —
    // condition nécessaire pour qu'embedChapterImages puisse le repérer et le
    // remplacer par un remplacement String.replace exact.
    return `\n\n${token}\n\n`;
  });
  return { markdown: out, images };
}

/**
 * Remplace, dans le HTML déjà rendu d'un chapitre, chaque jeton d'image
 * isolé (`<p>TOKEN</p>`, produit par markdownToHtml à partir de
 * tokenizeMarkdownImages) par le rendu fourni par `render` — DIFFÉRENT selon
 * la sortie visée (data URI base64 pour le PDF, chemin relatif `images/…`
 * pour l'EPUB) : c'est pour ça que la résolution du token est faite ICI,
 * après coup, plutôt que pendant tokenizeMarkdownImages. PURE.
 */
export function embedChapterImages(
  html: string,
  images: readonly EbookImageRef[],
  render: (img: EbookImageRef) => string,
): string {
  let out = html;
  for (const img of images) {
    out = out.replaceAll(`<p>${img.token}</p>`, render(img));
  }
  return out;
}

/** Repli textuel quand une image ne peut pas être embarquée (clé absente, téléchargement en échec). */
function imageFallbackHtml(caption: string): string {
  return caption ? `<p><em>Figure : ${escapeHtml(caption)}</em></p>` : '';
}

/** Lit une clé du stockage en texte UTF-8. */
async function readText(key: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await getObjectStream(key)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Assemble les chapitres depuis le contenu DÉJÀ généré : articles (Markdown →
 * HTML) et vidéos (narration des slides = transcription en prose). Les leçons
 * sans contenu exploitable sont ignorées.
 */
export async function buildEbookChapters(courseId: string): Promise<EbookChapter[]> {
  const sections = await Section.find({ courseId }).sort({ order: 1 }).lean();
  const chapters: EbookChapter[] = [];
  // Compteur PARTAGÉ entre tous les chapitres (cf. commentaire de tokenizeMarkdownImages).
  let imgCounter = 0;
  const nextIndex = (): number => imgCounter++;

  for (const section of sections) {
    const lessons = await Lesson.find({ sectionId: section._id }).sort({ order: 1 }).lean();
    const parts: string[] = [];
    const images: EbookImageRef[] = [];

    for (const lesson of lessons) {
      const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);
      if (lesson.type === 'article') {
        const key = keys.article();
        if (await objectExists(key)) {
          const { markdown, images: found } = tokenizeMarkdownImages(await readText(key), courseId, nextIndex);
          images.push(...found);
          parts.push(`<h2>${escapeHtml(lesson.title)}</h2>\n${markdownToHtml(markdown)}`);
        }
      } else if (lesson.type === 'video') {
        const parsed = slideScriptSchema.safeParse(lesson.script);
        if (parsed.success && parsed.data.slides.length > 0) {
          const prose = parsed.data.slides
            .map((s) => s.narration?.trim())
            .filter((n): n is string => Boolean(n))
            .map((n) => `<p>${escapeHtml(n)}</p>`)
            .join('\n');
          if (prose) parts.push(`<h2>${escapeHtml(lesson.title)}</h2>\n${prose}`);
        }
      }
    }

    if (parts.length > 0) chapters.push({ title: section.title, html: parts.join('\n'), images });
  }
  return chapters;
}

/** Document HTML complet du livre (utilisé pour le rendu PDF). */
export function buildEbookHtml(courseTitle: string, chapters: EbookChapter[]): string {
  const toc = chapters.map((c, i) => `<li><a href="#ch${i}">${escapeHtml(c.title)}</a></li>`).join('\n');
  const body = chapters
    .map((c, i) => `<section class="chapter"><h1 id="ch${i}">${escapeHtml(c.title)}</h1>\n${c.html}</section>`)
    .join('\n');
  return [
    '<!doctype html><html><head><meta charset="utf-8" />',
    `<title>${escapeHtml(courseTitle)}</title>`,
    '<style>',
    'body{font-family:Georgia,serif;line-height:1.6;color:#111;margin:0;padding:2rem;}',
    'h1{font-size:1.9rem;margin-top:0;page-break-before:always;}',
    'section.chapter:first-of-type h1{page-break-before:avoid;}',
    'h2{font-size:1.3rem;margin-top:1.6rem;}',
    'pre{background:#f5f5f5;padding:.8rem;overflow-x:auto;border-radius:4px;}',
    'code{font-family:Menlo,monospace;font-size:.9em;}',
    '.cover{text-align:center;padding:6rem 0;page-break-after:always;}',
    '.cover h1{font-size:2.6rem;page-break-before:avoid;}',
    '</style></head><body>',
    `<div class="cover"><h1>${escapeHtml(courseTitle)}</h1><p>Version livre du cours</p></div>`,
    `<nav><h1>Sommaire</h1><ol>${toc}</ol></nav>`,
    body,
    '</body></html>',
  ].join('\n');
}

/** Rend le livre en PDF (Playwright ; PDF minimal en mode mock). */
async function renderEbookPdf(html: string, courseTitle: string, mock: boolean): Promise<Buffer> {
  if (mock) return Buffer.from(`%PDF-1.4\n% [mock] ebook\n% ${courseTitle}\n%%EOF\n`, 'utf-8');
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

/** Collecte une archive `archiver` en Buffer. */
function zipToBuffer(build: (a: archiver.Archiver) => void): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
  });
  build(archive);
  void archive.finalize();
  return done;
}

/**
 * Identité du livre. Dérivée du `courseId` (immuable, unique) et NON du titre :
 * deux cours peuvent partager un titre — ils auraient alors le même identifiant
 * et se confondraient dans la bibliothèque de la liseuse — et un renommage ne
 * doit pas transformer une mise à jour en livre inconnu. PURE.
 */
export function epubBookId(courseId: string): string {
  return `urn:sallycourse:course:${escapeHtml(courseId)}`;
}

/**
 * Fichier image embarqué dans l'EPUB (correctif 1.7) : `id` sert à la fois
 * d'identifiant de manifest XML (doit être un NCName valide — les jetons
 * `SALLYCOURSE_EBOOK_IMG_N` le sont déjà, alnum+underscore) et de nom de
 * fichier sous `OEBPS/images/`.
 */
export interface EpubImageFile {
  id: string;
  ext: 'png' | 'jpeg';
  data: Buffer;
}

/** OPF (métadonnées + manifest + spine). PURE — testable sans dézipper. */
export function buildEpubOpf(
  courseId: string,
  courseTitle: string,
  locale: string,
  chapters: EbookChapter[],
  images: EpubImageFile[] = [],
  coverId?: string,
): string {
  const ids = chapters.map((_, i) => `ch${i}`);
  const manifest = ids.map((id) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ');
  const spine = ids.map((id) => `<itemref idref="${id}"/>`).join('\n    ');
  const imageManifest = images
    .map((img) => `<item id="${img.id}" href="images/${img.id}.${img.ext}" media-type="image/${img.ext}"/>`)
    .join('\n    ');
  // `<meta name="cover">` : convention EPUB 2 (pas de `properties="cover-image"`,
  // réservée à EPUB 3) pour que les liseuses affichent une vignette de couverture.
  const coverMeta = coverId ? `\n    <meta name="cover" content="${coverId}"/>` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `    <dc:title>${escapeHtml(courseTitle)}</dc:title>`,
    `    <dc:language>${escapeHtml(locale)}</dc:language>`,
    `    <dc:identifier id="bookid">${epubBookId(courseId)}</dc:identifier>${coverMeta}`,
    '  </metadata>',
    '  <manifest>',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    `    ${manifest}`,
    ...(imageManifest ? [`    ${imageManifest}`] : []),
    '  </manifest>',
    '  <spine toc="ncx">',
    `    ${spine}`,
    '  </spine>',
    '</package>',
  ].join('\n');
}

/** NCX (sommaire). `dtb:uid` DOIT être identique au `dc:identifier` de l'OPF. PURE. */
export function buildEpubNcx(courseId: string, courseTitle: string, chapters: EbookChapter[]): string {
  const navPoints = chapters
    .map(
      (c, i) =>
        `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>${escapeHtml(c.title)}</text></navLabel><content src="ch${i}.xhtml"/></navPoint>`,
    )
    .join('\n    ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    `  <head><meta name="dtb:uid" content="${epubBookId(courseId)}"/></head>`,
    `  <docTitle><text>${escapeHtml(courseTitle)}</text></docTitle>`,
    '  <navMap>',
    `    ${navPoints}`,
    '  </navMap>',
    '</ncx>',
  ].join('\n');
}

/**
 * Construit un EPUB 2 valide. Trois exigences du format, toutes tenues ici :
 *  - `mimetype` = 1re entrée de l'archive, NON compressée (store),
 *  - `spine` et `navMap` doivent contenir AU MOINS un élément (d'où la garde
 *    sur `chapters` : une archive à 0 chapitre serait un ZIP lisible mais un
 *    EPUB structurellement invalide),
 *  - `dtb:uid` (NCX) IDENTIQUE au `dc:identifier` (OPF) — cf. epubBookId.
 */
export function buildEpub(
  courseId: string,
  courseTitle: string,
  locale: string,
  chapters: EbookChapter[],
  /** Images à embarquer (correctif 1.7) — additif, vide par défaut (comportement inchangé). */
  images: EpubImageFile[] = [],
  /** Image de couverture optionnelle (correctif 1.7 : « EPUB sans cover déclarée »). */
  cover?: EpubImageFile,
): Promise<Buffer> {
  if (chapters.length === 0) {
    return Promise.reject(new Error('buildEpub : au moins un chapitre est requis (spine/navMap vides = EPUB invalide)'));
  }
  const allImages = cover ? [...images, cover] : images;
  const opf = buildEpubOpf(courseId, courseTitle, locale, chapters, allImages, cover?.id);
  const ncx = buildEpubNcx(courseId, courseTitle, chapters);

  const container = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
    '</container>',
  ].join('\n');

  return zipToBuffer((a) => {
    // 1re entrée, NON compressée — exigence du format EPUB.
    a.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
    a.append(Buffer.from(container, 'utf8'), { name: 'META-INF/container.xml' });
    a.append(Buffer.from(opf, 'utf8'), { name: 'OEBPS/content.opf' });
    a.append(Buffer.from(ncx, 'utf8'), { name: 'OEBPS/toc.ncx' });
    chapters.forEach((c, i) => {
      const xhtml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE html>',
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>',
        `<title>${escapeHtml(c.title)}</title></head><body>`,
        `<h1>${escapeHtml(c.title)}</h1>`,
        c.html,
        '</body></html>',
      ].join('\n');
      a.append(Buffer.from(xhtml, 'utf8'), { name: `OEBPS/ch${i}.xhtml` });
    });
    for (const img of allImages) {
      a.append(img.data, { name: `OEBPS/images/${img.id}.${img.ext}` });
    }
  });
}

/**
 * Télécharge une clé de stockage en Buffer (best-effort) : `null` si absente
 * ou illisible — l'appelant retombe alors sur la légende texte plutôt que de
 * faire échouer tout l'ebook pour une image.
 */
async function downloadImage(key: string): Promise<Buffer | null> {
  try {
    if (!(await objectExists(key))) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of await getObjectStream(key)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    logger.warn({ key, err }, 'ebook : image illisible depuis le storage — repli sur la légende');
    return null;
  }
}

/** Génère l'ebook (EPUB + PDF) et pose Course.repurposing.ebook. Jette en cas d'échec. */
export async function generateCourseEbook(courseId: string): Promise<{ chapters: number }> {
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const chapters = await buildEbookChapters(courseId);
  if (chapters.length === 0) throw new Error('aucun contenu exploitable pour l’ebook');

  const mock = getConfig().MOCK_PROVIDERS;
  const keys = storageKeys.course(courseId);

  // Correctif 1.7 (audit 2026-07-20) : télécharge CHAQUE image référencée UNE
  // SEULE FOIS (dédoublonnée par clé), partagée entre le rendu PDF (data URI)
  // et l'EPUB (fichier binaire du manifest) — évite de retélécharger la même
  // capture deux fois pour les deux formats.
  const allRefs = chapters.flatMap((c) => c.images ?? []);
  const uniqueKeys = [...new Set(allRefs.map((r) => r.key).filter((k): k is string => Boolean(k)))];
  const buffers = new Map<string, Buffer>();
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const buf = await downloadImage(key);
      if (buf) buffers.set(key, buf);
    }),
  );

  const pdfChapters = chapters.map((c) => ({
    ...c,
    html: embedChapterImages(c.html, c.images ?? [], (img) => {
      const buf = img.key ? buffers.get(img.key) : undefined;
      if (!buf) return imageFallbackHtml(img.caption);
      const figcaption = img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : '';
      return `<figure><img src="data:image/png;base64,${buf.toString('base64')}" alt="${escapeHtml(img.caption)}"/>${figcaption}</figure>`;
    }),
  }));

  const epubImages: EpubImageFile[] = [];
  const epubChapters = chapters.map((c) => ({
    ...c,
    html: embedChapterImages(c.html, c.images ?? [], (img) => {
      const buf = img.key ? buffers.get(img.key) : undefined;
      if (!buf) return imageFallbackHtml(img.caption);
      epubImages.push({ id: img.token, ext: 'png', data: buf });
      const figcaption = img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : '';
      return `<figure><img src="images/${img.token}.png" alt="${escapeHtml(img.caption)}"/>${figcaption}</figure>`;
    }),
  }));

  // Cover EPUB (audit : « EPUB sans cover déclarée ») — best-effort, absente si
  // Course.coverImageUrl n'est pas encore générée ou introuvable en storage.
  let coverImage: EpubImageFile | undefined;
  if (course.coverImageUrl) {
    const coverBuf = await downloadImage(course.coverImageUrl);
    if (coverBuf) coverImage = { id: 'cover-img', ext: 'png', data: coverBuf };
  }

  const [pdf, epub] = await Promise.all([
    renderEbookPdf(buildEbookHtml(course.title, pdfChapters), course.title, mock),
    buildEpub(courseId, course.title, course.locale, epubChapters, epubImages, coverImage),
  ]);

  const pdfKey = keys.ebook('pdf');
  const epubKey = keys.ebook('epub');
  await Promise.all([
    uploadObject(pdfKey, pdf, 'application/pdf'),
    uploadObject(epubKey, epub, 'application/epub+zip'),
  ]);
  await Course.updateOne({ _id: courseId }, { $set: { 'repurposing.ebook': { epubKey, pdfKey } } });

  logger.info({ courseId, chapters: chapters.length }, 'ebook généré (EPUB + PDF)');
  return { chapters: chapters.length };
}

/** Variante best-effort (jamais fatale) pour la finalisation du cours. */
export async function generateCourseEbookBestEffort(courseId: string): Promise<void> {
  try {
    await generateCourseEbook(courseId);
  } catch (err) {
    logger.warn({ courseId, err }, 'génération ebook échouée — ignorée (best-effort)');
  }
}
