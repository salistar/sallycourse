// Repurposing courts TikTok/Instagram/Shorts (Prompt 106).
//
// PAS un adapter de déploiement classique (pas de createCourse/uploadLesson au
// sens du contrat DeploymentAdapter) : ce module découpe une leçon vidéo DÉJÀ
// RENDUE en 15-30 clips verticaux 9:16, un par « passage dense » du script de
// narration (SlideScript — cf. schemas/lesson-content.ts), puis planifie leur
// publication sur TikTok/Instagram.
//
// Pipeline :
//   1. detectDenseSegments  — repère les slides les plus denses (mots-clés,
//      bullets, longueur de narration) à partir du SlideScript déjà généré ;
//      pur, aucune I/O.
//   2. selectTopSegments    — retient les N meilleurs par leçon (15-30, borné
//      par SHORTS.MIN_CLIPS_PER_LESSON / MAX_CLIPS_PER_LESSON) ; pur.
//   3. buildCropArgs        — arguments ffmpeg de recadrage 9:16 (crop centré
//      depuis le 16:9 source), réutilise les conventions de video-render.ts
//      (mêmes options de codec) ; pur.
//   4. buildKaraokeAssArgs  — sous-titres karaoké mot-par-mot en ASS (burned-in
//      via -vf ass=), à partir des timestamps Whisper existants (subtitle-
//      generation.ts produit déjà un .srt ; ici on dérive un minutage mot par
//      mot approximatif à partir de la narration + audioSeconds, cf. plus bas) ;
//      pur.
//   5. generateHook         — accroche 3-5 mots via callClaudeJson (repli
//      déterministe en mode mock).
//   6. renderShortClip      — orchestration I/O : télécharge la vidéo source,
//      recadre + sous-titre via ffmpeg (execa), upload le clip vertical, crée
//      le document ShortClip (status 'draft').
//   7. scheduleClipPublish / publishScheduledClip — calendrier programmé
//      (ShortClip.scheduledAt) + publication MOCK-FRIENDLY via TikTok Content
//      Posting API / Instagram Graph API (fetch REST, OAuth credentials).

import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { execa } from 'execa';
import { z } from 'zod';
import {
  getConfig,
  getObjectStream,
  storageKeys,
  uploadObject,
  ShortClip,
  type ILesson,
  type ShortClipDocument,
  type ShortClipPlatform,
} from '../../shared.js';
import { callClaudeJson } from '../../lib/claude.js';
import type { Slide, SlideScript } from '../../shared.js';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const SHORTS = {
  /** Bornes du nombre de clips retenus par leçon (règle métier du prompt). */
  MIN_CLIPS_PER_LESSON: 15,
  MAX_CLIPS_PER_LESSON: 30,
  /** Durée cible d'un clip vertical, en secondes (format court standard). */
  MIN_CLIP_SECONDS: 15,
  MAX_CLIP_SECONDS: 60,
  /** Dimensions du crop 9:16 en sortie (résolution portrait standard). */
  WIDTH: 1080,
  HEIGHT: 1920,
} as const;

/* ------------------------------------------------------------------ */
/* 1) Détection des passages denses (pur)                              */
/* ------------------------------------------------------------------ */

/** Mots-outils français ignorés dans le calcul de densité (liste courte, volontairement simple). */
const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'à', 'au',
  'aux', 'en', 'dans', 'sur', 'pour', 'par', 'ce', 'cette', 'ces', 'qui',
  'que', 'est', 'sont', 'avec', 'sans', 'plus', 'pas', 'on', 'il', 'elle',
]);

/** Un segment dense détecté dans une slide : offset temporel + score. */
export interface DenseSegment {
  /** Index de la slide dans SlideScript.slides. */
  slideIndex: number;
  /** Offset de début du segment dans la vidéo assemblée, en secondes. */
  startSec: number;
  /** Offset de fin, en secondes. */
  endSec: number;
  /** Score de densité (mots-clés/bullets/longueur) — plus haut = plus pertinent. */
  score: number;
  /** Texte de narration du segment (source du hook). */
  narration: string;
}

/**
 * Score de densité d'une slide : nombre de bullets (structuration explicite)
 * + ratio de mots "significatifs" (hors stopwords) dans la narration + bonus
 * pour les templates à forte valeur (code, comparison, diagram — contenus
 * qui « accrochent » davantage en format court). Pur, déterministe.
 */
export function scoreSlideDensity(slide: Slide): number {
  const words = slide.narration
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 0;

  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  const keywordRatio = meaningful.length / words.length;

  const bulletsBonus = Math.min(slide.bullets.length, 5) * 2;
  const templateBonus = slide.template === 'code' || slide.template === 'comparison' || slide.template === 'diagram' ? 5 : 0;
  // Longueur : ni trop courte (pas de matière) ni trop longue (diluée) — pic autour de 20-60 mots.
  const lengthScore = words.length >= 8 ? Math.min(words.length, 60) / 6 : words.length / 3;

  return Math.round((keywordRatio * 20 + bulletsBonus + templateBonus + lengthScore) * 10) / 10;
}

/**
 * Détecte les passages denses d'un script de leçon : une slide = un segment
 * candidat, borné à [MIN_CLIP_SECONDS, MAX_CLIP_SECONDS] (une slide plus longue
 * que MAX_CLIP_SECONDS est tronquée à cette durée depuis son début ; une slide
 * plus courte que MIN_CLIP_SECONDS reste telle quelle — le rendu FFmpeg ne
 * doit jamais dépasser la durée réelle disponible). `introSeconds` décale tous
 * les offsets (le montage final commence par un segment d'intro, cf.
 * video-render.ts VIDEO.INTRO_SECONDS). Pur, testable sans ffmpeg/DB.
 */
export function detectDenseSegments(script: SlideScript, introSeconds = 0): DenseSegment[] {
  let cursor = introSeconds;
  const segments: DenseSegment[] = [];

  script.slides.forEach((slide, slideIndex) => {
    const duration = typeof slide.audioSeconds === 'number' && slide.audioSeconds > 0 ? slide.audioSeconds : 1;
    const startSec = cursor;
    const clipDuration = Math.min(duration, SHORTS.MAX_CLIP_SECONDS);
    const endSec = startSec + clipDuration;
    cursor += duration;

    segments.push({
      slideIndex,
      startSec: Math.round(startSec * 100) / 100,
      endSec: Math.round(endSec * 100) / 100,
      score: scoreSlideDensity(slide),
      narration: slide.narration,
    });
  });

  return segments;
}

/**
 * Retient les N meilleurs segments (score décroissant), bornés entre
 * MIN_CLIPS_PER_LESSON et MAX_CLIPS_PER_LESSON quand assez de matière est
 * disponible ; si la leçon a moins de slides que le minimum, retourne tout ce
 * qui est disponible (dégradation gracieuse, jamais d'erreur). L'ordre de
 * sortie est remis dans l'ordre chronologique (slideIndex croissant) — la
 * sélection se fait par score, la publication suit la narration.
 */
export function selectTopSegments(
  segments: readonly DenseSegment[],
  maxClips: number = SHORTS.MAX_CLIPS_PER_LESSON,
): DenseSegment[] {
  const sorted = [...segments].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, Math.max(0, maxClips));
  return top.sort((a, b) => a.slideIndex - b.slideIndex);
}

/* ------------------------------------------------------------------ */
/* 2) Recadrage FFmpeg 9:16 (pur — construction d'arguments)           */
/* ------------------------------------------------------------------ */

/**
 * Arguments ffmpeg de recadrage centré 16:9 → 9:16 : crop calculé sur la
 * largeur (on garde toute la hauteur, on rogne les côtés), puis scale vers
 * les dimensions cibles. `input`/`output` sont des chemins locaux ; `startSec`/
 * `endSec` bornent l'extrait dans la vidéo source (-ss avant -i : seek rapide).
 * Réutilise les conventions de codec de video-render.ts (H.264/AAC, yuv420p).
 */
export function buildCropArgs(
  input: string,
  output: string,
  startSec: number,
  endSec: number,
  width: number = SHORTS.WIDTH,
  height: number = SHORTS.HEIGHT,
): string[] {
  const duration = Math.max(0.1, endSec - startSec);
  // Crop 9:16 centré : largeur cible = hauteur_source * 9/16, décalage horizontal centré.
  const cropExpr = `crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;

  return [
    '-y',
    '-ss',
    startSec.toFixed(3),
    '-i',
    input,
    '-t',
    duration.toFixed(3),
    '-vf',
    cropExpr,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2',
    output,
  ];
}

/* ------------------------------------------------------------------ */
/* 3) Sous-titres karaoké (pur — construction ASS + arguments burned-in)*/
/* ------------------------------------------------------------------ */

/** Un mot chronométré (timestamp Whisper existant ou dérivé de la narration). */
export interface WordTiming {
  word: string;
  startSec: number;
  endSec: number;
}

/**
 * Dérive un minutage mot par mot approximatif à partir d'une narration et de
 * sa durée totale mesurée (audioSeconds) : répartition proportionnelle à la
 * longueur de chaque mot (les mots longs occupent plus de temps de lecture
 * qu'un mot court — approximation simple mais stable, sans dépendance à un
 * alignement phonétique). Sert de repli quand aucun alignement Whisper mot à
 * mot n'est disponible pour la leçon (le SRT existant est au niveau de la
 * phrase, pas du mot). Pur.
 */
export function deriveWordTimings(narration: string, totalSeconds: number): WordTiming[] {
  const words = narration.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || totalSeconds <= 0) return [];

  const totalChars = words.reduce((acc, w) => acc + w.length, 0) || 1;
  let cursor = 0;
  return words.map((word) => {
    const share = word.length / totalChars;
    const duration = Math.max(0.05, share * totalSeconds);
    const startSec = cursor;
    const endSec = Math.min(totalSeconds, cursor + duration);
    cursor = endSec;
    return { word, startSec: Math.round(startSec * 1000) / 1000, endSec: Math.round(endSec * 1000) / 1000 };
  });
}

/** Échappe les caractères spéciaux ASS (accolades, retours ligne). */
function escapeAss(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');
}

/** Formate une durée en timestamp ASS (H:MM:SS.cc). */
function formatAssTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Construit un fichier .ass minimal avec un événement PAR MOT (karaoké simple :
 * un mot affiché en surbrillance à la fois, pas de \k tags — plus robuste pour
 * un burned-in via le filtre ffmpeg `ass=`). Style unique, gros et centré bas
 * d'écran (lisible en format vertical mobile).
 */
export function buildKaraokeAss(timings: readonly WordTiming[]): string {
  const header =
    '[Script Info]\n' +
    'ScriptType: v4.00+\n' +
    `PlayResX: ${SHORTS.WIDTH}\n` +
    `PlayResY: ${SHORTS.HEIGHT}\n\n` +
    '[V4+ Styles]\n' +
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, BorderStyle, Outline, Alignment, MarginV\n' +
    'Style: Karaoke,Arial,72,&H00FFFFFF,&H00000000,1,1,3,2,180\n\n' +
    '[Events]\n' +
    'Format: Layer, Start, End, Style, Text\n';

  const lines = timings.map(
    (t) => `Dialogue: 0,${formatAssTimestamp(t.startSec)},${formatAssTimestamp(t.endSec)},Karaoke,${escapeAss(t.word.toUpperCase())}`,
  );
  return header + lines.join('\n') + '\n';
}

/**
 * Arguments ffmpeg pour incruster (burn-in) un fichier .ass sur une vidéo déjà
 * recadrée. Le chemin est échappé pour le filtre `ass=` (Windows : ':' doit
 * être échappé dans le chemin du filtre).
 */
export function buildBurnSubtitlesArgs(input: string, assPath: string, output: string): string[] {
  const escapedPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return [
    '-y',
    '-i',
    input,
    '-vf',
    `ass=${escapedPath}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    output,
  ];
}

/* ------------------------------------------------------------------ */
/* 4) Hook généré par Claude (accroche 3-5 mots)                        */
/* ------------------------------------------------------------------ */

const hookSchema = z.object({
  hook: z.string().min(1),
});

/** Accroche déterministe de repli (mode mock) — 4 premiers mots significatifs de la narration. */
function fallbackHook(narration: string): string {
  const words = narration
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  const text = words.join(' ') || 'À ne pas manquer';
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Génère une accroche de 3-5 mots pour un clip, à partir de sa narration
 * source. Mode mock (MOCK_PROVIDERS ou clé absente) : callClaudeJson retombe
 * déjà sur une fixture locale déterministe côté client — ici on ajoute un
 * repli supplémentaire purement local si l'appel échoue pour une raison
 * quelconque, pour ne jamais bloquer le pipeline de rendu sur un hook manquant.
 */
export async function generateHook(narration: string, courseTitle: string): Promise<string> {
  try {
    const result = await callClaudeJson({
      schema: hookSchema,
      system:
        'Tu es un expert en formats courts (TikTok/Reels/Shorts). Réponds en JSON strict ' +
        '{"hook": "..."} avec une accroche de 3 à 5 mots en français, percutante, sans ponctuation finale.',
      user: `Cours : ${courseTitle}\nExtrait de narration : ${narration.slice(0, 500)}`,
    });
    return result.hook;
  } catch {
    return fallbackHook(narration);
  }
}

/* ------------------------------------------------------------------ */
/* 5) Orchestration I/O — rendu d'un clip                               */
/* ------------------------------------------------------------------ */

/** Télécharge un objet S3 vers un fichier local ; false si absent. */
async function downloadToFile(key: string, dest: string): Promise<boolean> {
  try {
    const stream = (await getObjectStream(key)) as Readable;
    await pipeline(stream, createWriteStream(dest));
    return true;
  } catch {
    return false;
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execa('ffmpeg', args);
}

export interface RenderShortClipsResult {
  lessonId: string;
  clips: ShortClipDocument[];
}

/**
 * Découpe une leçon vidéo déjà rendue en clips courts (jusqu'à MAX_CLIPS_PER_LESSON),
 * un ShortClip (status 'draft') par segment retenu. `platform` détermine
 * uniquement la valeur persistée (le rendu vidéo est identique quelle que soit
 * la plateforme cible — seule la publication diffère, cf. publishScheduledClip).
 * Ne jette jamais sur l'absence de vidéo source : retourne un tableau vide
 * (dégradation gracieuse, la leçon n'est peut-être pas de type vidéo).
 */
export async function renderShortClips(
  courseId: string,
  lessonId: string,
  lesson: Pick<ILesson, 'title' | 'script' | 'sectionId' | 'order'>,
  sectionOrder: number,
  courseTitle: string,
  platform: ShortClipPlatform,
): Promise<RenderShortClipsResult> {
  const parsed = lesson.script as SlideScript | undefined;
  if (!parsed || !Array.isArray((parsed as SlideScript)?.slides)) {
    return { lessonId, clips: [] };
  }

  const videoKey = storageKeys.course(courseId).lesson(sectionOrder, lesson.order).video();
  const allSegments = detectDenseSegments(parsed);
  const topSegments = selectTopSegments(allSegments);
  if (topSegments.length === 0) return { lessonId, clips: [] };

  const mock = getConfig().MOCK_PROVIDERS;
  const dir = await mkdtemp(path.join(tmpdir(), `shorts-${lessonId}-`));
  const clips: ShortClipDocument[] = [];

  try {
    let sourceOk = true;
    const sourcePath = path.join(dir, 'source.mp4');
    if (!mock) {
      sourceOk = await downloadToFile(videoKey, sourcePath);
    }
    if (!mock && !sourceOk) {
      // Vidéo source absente : rien à découper, dégradation gracieuse.
      return { lessonId, clips: [] };
    }

    for (let i = 0; i < topSegments.length; i += 1) {
      const segment = topSegments[i]!;
      const clipKey = `${storageKeys.course(courseId).lesson(sectionOrder, lesson.order).prefix}/shorts/${platform}-${i}.mp4`;
      const hook = await generateHook(segment.narration, courseTitle);

      if (!mock) {
        const croppedPath = path.join(dir, `crop-${i}.mp4`);
        await runFfmpeg(buildCropArgs(sourcePath, croppedPath, segment.startSec, segment.endSec));

        const timings = deriveWordTimings(segment.narration, segment.endSec - segment.startSec);
        const assPath = path.join(dir, `sub-${i}.ass`);
        await writeFile(assPath, buildKaraokeAss(timings), 'utf8');

        const finalPath = path.join(dir, `final-${i}.mp4`);
        await runFfmpeg(buildBurnSubtitlesArgs(croppedPath, assPath, finalPath));

        await uploadObject(clipKey, await readFile(finalPath), 'video/mp4');
      }

      const clip = await ShortClip.create({
        courseId,
        lessonId,
        platform,
        order: i,
        hook,
        startSec: segment.startSec,
        endSec: segment.endSec,
        videoKey: clipKey,
        status: 'draft',
      });
      clips.push(clip);
    }

    return { lessonId, clips };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* 6) Calendrier de publication programmée                             */
/* ------------------------------------------------------------------ */

/**
 * Répartit N clips sur un calendrier de publication : un clip tous les
 * `intervalHours` heures à partir de `startAt` (défaut : maintenant + 1h,
 * pour laisser le temps à une revue manuelle). Pur — ne persiste rien.
 */
export function buildPublishSchedule(
  clipCount: number,
  startAt: Date = new Date(Date.now() + 3600_000),
  intervalHours = 6,
): Date[] {
  const schedule: Date[] = [];
  for (let i = 0; i < clipCount; i += 1) {
    schedule.push(new Date(startAt.getTime() + i * intervalHours * 3600_000));
  }
  return schedule;
}

/** Applique un calendrier de publication aux clips d'une leçon (status → 'scheduled'). */
export async function scheduleClipPublish(
  clips: readonly ShortClipDocument[],
  startAt?: Date,
  intervalHours?: number,
): Promise<void> {
  const schedule = buildPublishSchedule(clips.length, startAt, intervalHours);
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]!;
    clip.scheduledAt = schedule[i];
    clip.status = 'scheduled';
    await clip.save();
  }
}

/* ------------------------------------------------------------------ */
/* 7) Publication (TikTok Content Posting API / Instagram Graph API)   */
/* ------------------------------------------------------------------ */

const TIKTOK_API = 'https://open.tiktokapis.com/v2';
const INSTAGRAM_GRAPH_API = 'https://graph.facebook.com/v19.0';

/** Publie un clip planifié sur sa plateforme cible. MOCK-friendly : simule la publication (aucun réseau) si MOCK_PROVIDERS ou credentials absents. */
export async function publishScheduledClip(
  clip: ShortClipDocument,
  credentials: Record<string, string>,
): Promise<{ externalId: string; externalUrl: string }> {
  const mock = getConfig().MOCK_PROVIDERS || !credentials.accessToken;

  if (mock) {
    const externalId = `${clip.platform}_mock_${String(clip._id)}`;
    const externalUrl =
      clip.platform === 'tiktok'
        ? `https://www.tiktok.com/@sallycourse/video/${externalId}`
        : `https://www.instagram.com/reel/${externalId}`;
    clip.externalId = externalId;
    clip.externalUrl = externalUrl;
    clip.status = 'published';
    await clip.save();
    return { externalId, externalUrl };
  }

  const videoUrl = await presignedUrlOrKey(clip.videoKey);
  const accessToken = credentials.accessToken ?? '';

  try {
    const result =
      clip.platform === 'tiktok'
        ? await publishToTikTok(accessToken, videoUrl, clip.hook)
        : await publishToInstagram(accessToken, credentials.igUserId ?? '', videoUrl, clip.hook);

    clip.externalId = result.externalId;
    clip.externalUrl = result.externalUrl;
    clip.status = 'published';
    await clip.save();
    return result;
  } catch (err) {
    clip.status = 'failed';
    await clip.save();
    throw err;
  }
}

/** Résout une URL présignée pour la clé donnée (import différé pour ne pas alourdir les tests purs). */
async function presignedUrlOrKey(key: string): Promise<string> {
  const { presignedGetUrl } = await import('../../shared.js');
  return presignedGetUrl(key, 3600);
}

/** TikTok Content Posting API (video/init puis publication directe par URL). */
async function publishToTikTok(
  accessToken: string,
  videoUrl: string,
  caption: string,
): Promise<{ externalId: string; externalUrl: string }> {
  const res = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      post_info: { title: caption, privacy_level: 'PUBLIC_TO_EVERYONE' },
      source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TikTok publish/video/init → HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { publish_id?: string } };
  const publishId = json.data?.publish_id ?? '';
  return { externalId: publishId, externalUrl: `https://www.tiktok.com/@sallycourse/video/${publishId}` };
}

/** Instagram Graph API (Reels) : media (video_url) puis media_publish. */
async function publishToInstagram(
  accessToken: string,
  igUserId: string,
  videoUrl: string,
  caption: string,
): Promise<{ externalId: string; externalUrl: string }> {
  const createRes = await fetch(
    `${INSTAGRAM_GRAPH_API}/${igUserId}/media?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'REELS', video_url: videoUrl, caption }),
    },
  );
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    throw new Error(`Instagram media → HTTP ${createRes.status} ${text.slice(0, 200)}`);
  }
  const created = (await createRes.json()) as { id?: string };
  const containerId = created.id ?? '';

  const publishRes = await fetch(
    `${INSTAGRAM_GRAPH_API}/${igUserId}/media_publish?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId }),
    },
  );
  if (!publishRes.ok) {
    const text = await publishRes.text().catch(() => '');
    throw new Error(`Instagram media_publish → HTTP ${publishRes.status} ${text.slice(0, 200)}`);
  }
  const published = (await publishRes.json()) as { id?: string };
  const mediaId = published.id ?? containerId;
  return { externalId: mediaId, externalUrl: `https://www.instagram.com/reel/${mediaId}` };
}
