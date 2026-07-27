// Générateur de PODCAST (Prompt 202) : transforme un cours en podcast audio en
// concaténant, PAR SECTION, les narrations déjà synthétisées des leçons vidéo
// (aucun nouvel appel TTS) en un épisode MP3, puis génère un flux RSS conforme
// (soumission Spotify/Apple Podcasts). Best-effort : un échec n'invalide jamais
// la finalisation du cours.
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Course,
  Lesson,
  Section,
  escapeHtml,
  objectExists,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  getObjectStream,
} from '../shared.js';
import { logger } from '../queues/index.js';

/** Base URL publique des médias (enclosures RSS) — dérivée du stockage objet.
 * Lit process.env directement (pas getConfig) pour rester pur/testable. */
function mediaBaseUrl(): string {
  const base = process.env.PUBLIC_MEDIA_BASE?.trim();
  if (base) return base.replace(/\/+$/, '');
  const endpoint = (process.env.S3_ENDPOINT ?? '').replace(/\/+$/, '');
  const bucket = process.env.S3_BUCKET ?? '';
  return endpoint && bucket ? `${endpoint}/${bucket}` : '';
}

/**
 * Vrai si la base résolue est manifestement locale/interne (audit 2026-07-20,
 * correctif 1.3) — AVANT ce correctif, seule une base COMPLÈTEMENT ABSENTE
 * déclenchait un avertissement ; or `S3_ENDPOINT=http://localhost:9000` (repli
 * par défaut de `mediaBaseUrl`) produit une base NON VIDE, donc le warning ne
 * se déclenchait jamais alors que les enclosures pointaient vers MinIO dev,
 * injoignable hors de la machine de génération.
 */
export function isLocalMediaBase(base: string): boolean {
  if (!base) return true;
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false; // base relative ou non-URL : déjà couvert par le cas "vide" ailleurs.
  }
}

/** Télécharge une clé S3 dans un fichier local. */
async function downloadTo(key: string, dest: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of await getObjectStream(key)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await writeFile(dest, Buffer.concat(chunks));
}

/** Un épisode produit (une section). */
export interface Episode {
  order: number;
  title: string;
  key: string;
  durationSec: number;
  /** Taille du MP3 en octets — obligatoire dans `enclosure@length` (RSS 2.0). */
  bytes: number;
}

/**
 * Génère les épisodes (un par section ayant de l'audio) + le flux RSS, pose
 * Course.repurposing.podcast. Jette en cas d'échec.
 */
export async function generateCoursePodcast(courseId: string): Promise<{ episodes: number }> {
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const sections = await Section.find({ courseId }).sort({ order: 1 }).lean();
  const keys = storageKeys.course(courseId);
  const episodes: Episode[] = [];

  const dir = await mkdtemp(path.join(tmpdir(), 'podcast-'));
  try {
    for (const section of sections) {
      const videoLessons = await Lesson.find({ sectionId: section._id, type: 'video' }).sort({ order: 1 }).lean();
      // Rassemble les MP3 de slide (déjà synthétisés) de toutes les leçons vidéo.
      const audioKeys: string[] = [];
      for (const lesson of videoLessons) {
        const parsed = slideScriptSchema.safeParse(lesson.script);
        const slideCount = parsed.success ? parsed.data.slides.length : 0;
        const lessonKeys = storageKeys.course(courseId).lesson(section.order, lesson.order);
        for (let i = 0; i < slideCount; i += 1) {
          const k = lessonKeys.audio(i);
          if (await objectExists(k)) audioKeys.push(k);
        }
      }
      if (audioKeys.length === 0) continue;

      // Télécharge + concatène en un épisode MP3 (ré-encodage pour robustesse).
      const localFiles: string[] = [];
      for (let i = 0; i < audioKeys.length; i += 1) {
        const p = path.join(dir, `s${section.order}-${i}.mp3`);
        await downloadTo(audioKeys[i]!, p);
        localFiles.push(p);
      }
      const listPath = path.join(dir, `list-${section.order}.txt`);
      await writeFile(listPath, localFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
      const episodePath = path.join(dir, `episode-${section.order}.mp3`);
      await execa('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-q:a', '4', episodePath]);
      const { stdout } = await execa('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        episodePath,
      ]);
      const episodeKey = keys.podcastEpisode(section.order);
      const mp3 = await readFile(episodePath);
      await uploadObject(episodeKey, mp3, 'audio/mpeg');
      episodes.push({
        order: section.order,
        title: section.title,
        key: episodeKey,
        durationSec: Math.round(Number.parseFloat(stdout.trim()) || 0),
        bytes: mp3.byteLength,
      });
    }

    if (episodes.length === 0) throw new Error('aucune narration disponible pour le podcast');

    // Un flux sans base publique produit des enclosures en URL RELATIVE : le
    // fichier reste lisible chez nous, mais Apple/Spotify le refuseront. Une
    // base qui résout vers localhost/127.0.0.1 (repli par défaut sur
    // S3_ENDPOINT en dev) est tout aussi inutilisable en pratique — voir
    // isLocalMediaBase ci-dessus.
    const resolvedBase = mediaBaseUrl();
    if (isLocalMediaBase(resolvedBase)) {
      logger.warn(
        { courseId, resolvedBase },
        'podcast : base média locale/absente (PUBLIC_MEDIA_BASE non configuré) — enclosures inutilisables hors de cette machine, flux non soumissible en l’état',
      );
    }

    const feedKey = keys.podcastFeed();
    await uploadObject(
      feedKey,
      Buffer.from(
        buildPodcastRss(course.title, course.locale, episodes, {
          imageUrl: course.coverImageUrl && resolvedBase ? `${resolvedBase}/${course.coverImageUrl}` : undefined,
          generatedAt: new Date(),
        }),
        'utf8',
      ),
      'application/rss+xml; charset=utf-8',
    );
    await Course.updateOne({ _id: courseId }, { $set: { 'repurposing.podcast': { feedKey, episodes: episodes.length } } });

    logger.info({ courseId, episodes: episodes.length }, 'podcast généré (épisodes + flux RSS)');
    return { episodes: episodes.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Métadonnées additionnelles du flux (correctif 1.3, audit 2026-07-20) — toutes optionnelles, additif. */
export interface PodcastRssOptions {
  /** itunes:author — nom affiché comme auteur/producteur du podcast. */
  author?: string;
  /** itunes:image href — cover carrée (idéalement ≥1400px), typiquement Course.coverImageUrl résolue en URL absolue. */
  imageUrl?: string;
  /** itunes:category — catégorie Apple Podcasts (valeur libre, "Education" par défaut). */
  category?: string;
  /** Horodatage de génération : sert de <pubDate> (identique pour tous les items d'un même run) et <lastBuildDate>. */
  generatedAt?: Date;
}

/** Format RFC 1123/822 requis par <pubDate>/<lastBuildDate> (RSS 2.0). */
function toRfc822(date: Date): string {
  return date.toUTCString();
}

/** Construit un flux RSS podcast minimal mais conforme (enclosure par épisode). */
export function buildPodcastRss(
  courseTitle: string,
  locale: string,
  episodes: Episode[],
  options: PodcastRssOptions = {},
): string {
  const base = mediaBaseUrl();
  const { author = 'SallyCourse', imageUrl, category = 'Education', generatedAt = new Date() } = options;
  const pubDate = toRfc822(generatedAt);
  const items = episodes
    .map((ep) => {
      const url = base ? `${base}/${ep.key}` : ep.key;
      return [
        '    <item>',
        `      <title>${escapeHtml(ep.title)}</title>`,
        `      <guid isPermaLink="false">${escapeHtml(ep.key)}</guid>`,
        `      <enclosure url="${escapeHtml(url)}" type="audio/mpeg" length="${ep.bytes}" />`,
        `      <itunes:duration>${ep.durationSec}</itunes:duration>`,
        `      <pubDate>${pubDate}</pubDate>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');
  const channelExtras = [
    `    <itunes:author>${escapeHtml(author)}</itunes:author>`,
    `    <itunes:explicit>false</itunes:explicit>`,
    `    <itunes:category text="${escapeHtml(category)}" />`,
    imageUrl ? `    <itunes:image href="${escapeHtml(imageUrl)}" />` : null,
    `    <lastBuildDate>${pubDate}</lastBuildDate>`,
  ].filter((line): line is string => line !== null);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">',
    '  <channel>',
    `    <title>${escapeHtml(courseTitle)}</title>`,
    `    <language>${escapeHtml(locale)}</language>`,
    `    <description>${escapeHtml(`Version podcast du cours « ${courseTitle} ».`)}</description>`,
    ...channelExtras,
    items,
    '  </channel>',
    '</rss>',
  ].join('\n');
}

/** Variante best-effort (jamais fatale) pour la finalisation du cours. */
export async function generateCoursePodcastBestEffort(courseId: string): Promise<void> {
  try {
    await generateCoursePodcast(courseId);
  } catch (err) {
    logger.warn({ courseId, err }, 'génération podcast échouée — ignorée (best-effort)');
  }
}
