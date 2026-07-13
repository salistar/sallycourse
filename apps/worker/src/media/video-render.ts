// Rendu vidéo FFmpeg (Prompt 24) : assemble les slides PNG + audio mp3 d'une
// leçon en un MP4 H.264/AAC 1920×1080 -movflags +faststart.
//
// Choix d'assemblage (documenté) : plutôt qu'une cascade xfade vidéo (offsets à
// recalculer segment par segment, fragile dès qu'un audio manque), on procède
// en deux temps SIMPLES et robustes :
//   1. chaque slide devient un segment MP4 « image fixe animée par sa durée
//      audio » (loop image + audio de la slide, réencodé H.264) ;
//   2. les segments sont concaténés via le concat demuxer (pas de réencodage
//      vidéo, coupe franche), avec un FONDU AUDIO de type acrossfade appliqué
//      en cascade sur les pistes pour éviter les clics de raccord.
// L'intro (VIDEO.INTRO_SECONDS) est un segment supplémentaire placé en tête,
// silencieux, construit à partir d'une image (première frame D8 ou carte titre).
// Le crossfade VIDÉO (VIDEO.SLIDE_CROSSFADE_SECONDS) reste documenté par la spec
// D8 mais n'est PAS appliqué ici : le concat demuxer fait une coupe franche, le
// fondu se joue côté audio — compromis assumé pour la fiabilité du pipeline CPU.
//
// Ce fichier expose des helpers PURS (construction des arguments ffmpeg, plan de
// segments, filtre acrossfade) couverts par des tests, et l'orchestration I/O
// renderLessonVideo (téléchargements S3, ffmpeg via execa, vérification ffprobe).
//
// Prompt 78 — Optimisation vidéo :
//   - presets FFmpeg nommés (draft/final/nvenc) au lieu d'un preset codé en dur ;
//   - option 2-pass (qualité finale) pour l'encodage de segment ;
//   - détection GPU NVENC (execa ffmpeg -encoders), fallback silencieux x264 ;
//   - estimation de durée de rendu AVANT lancement (historique GenerationJob).
// La parallélisation par leçon reste gérée par la concurrency de la queue
// videoRender (CPU_CONCURRENCY.videoRender, cf. entrypoints/register-groups.ts) :
// chaque job = une leçon, BullMQ distribue les leçons sur les workers CPU
// disponibles ; augmenter WORKER_CPU_VIDEORENDER_CONCURRENCY parallélise donc
// directement le rendu inter-leçons sans changement de code ici.
//
// Prompt 82 — Avatar vidéo optionnel (bêta, Course.avatarEnabled/avatarId) :
//   POINT D'INSERTION PRÉCIS : le segment avatar est un segment PLEIN CADRE
//   (pas un overlay incrusté — choix documenté : plus simple à assembler avec
//   le pipeline concat demuxer existant, cohérent avec le reste du montage)
//   inséré :
//     - en TÊTE de la PREMIÈRE leçon d'une section (juste après le segment
//       d'intro carte titre historique, AVANT les slides) — avatarSegment 'intro' ;
//     - en QUEUE de la DERNIÈRE leçon d'une section (après la dernière slide,
//       dernier segment du montage) — avatarSegment 'outro'.
//   Le segment est généré UNE FOIS par section (cache S3 storageKeys…
//   avatarSegment) et réutilisé si déjà présent, pour ne pas re-solliciter
//   HeyGen à chaque leçon. Si Course.avatarEnabled est false (défaut), AUCUN
//   changement : le rendu historique (intro carte titre + slides) reste
//   inchangé bit pour bit.

import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { execa } from 'execa';
import {
  AVATAR,
  Course,
  Lesson,
  Section,
  VIDEO,
  getObjectStream,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  type SlideScript,
} from '../shared.js';
import { generateAvatarSegment } from './avatar.js';
import { buildMusicMixArgs, resolveMusicTrack } from './background-music.js';
import { buildFfmetadataChapters, buildChapterMuxArgs, lessonChaptersFromScript } from './video-chapters.js';
import { logger } from '../queues/index.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { recordRenderCost } from '../lib/cost.js';
import { checkCancelled, killIfActive } from '../lib/cancellation.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { type PlanId } from '@sallycourse/shared';

/** Cadence de sortie du MP4 (images/seconde) — alignée sur MOTION_FPS (D8). */
export const VIDEO_FPS = 30;
/** Débit audio AAC de la piste finale. */
export const AUDIO_BITRATE = '192k';
/** Tolérance de la vérification de durée (somme audio ±TOLERANCE s). */
export const DURATION_TOLERANCE_SECONDS = 2;

/* ------------------------------------------------------------------ */
/* Presets d'encodage (Prompt 78)                                       */
/* ------------------------------------------------------------------ */

/**
 * Presets nommés : « draft » privilégie la vitesse (aperçu rapide, qualité
 * moindre), « final » privilégie la qualité (livraison, plus lent), « nvenc »
 * délègue l'encodage au GPU NVIDIA quand disponible (cf. detectNvencEncoder).
 * CRF plus bas = meilleure qualité (x264 uniquement, non applicable à NVENC).
 */
export type RenderPreset = 'draft' | 'final' | 'nvenc';

interface PresetConfig {
  /** Codec vidéo ffmpeg (-c:v). */
  codec: string;
  /** Valeur -preset x264 (ignorée pour nvenc, qui utilise -preset p1..p7/rc). */
  x264Preset?: string;
  /** Valeur -crf (x264 uniquement). */
  crf?: number;
  /** Preset NVENC (p1=plus rapide … p7=meilleure qualité) + mode qualité. */
  nvencPreset?: string;
  nvencRateControl?: string;
  /** Débit cible NVENC (pas de CRF sur ce codec, -cq utilisé à la place). */
  nvencCq?: number;
}

/** Configuration par preset — SEULE source de vérité des paramètres d'encodage. */
export const PRESET_CONFIG: Record<RenderPreset, PresetConfig> = {
  draft: { codec: 'libx264', x264Preset: 'veryfast', crf: 21 },
  final: { codec: 'libx264', x264Preset: 'slow', crf: 19 },
  nvenc: { codec: 'h264_nvenc', nvencPreset: 'p5', nvencRateControl: 'vbr', nvencCq: 19 },
};

/** Preset appliqué par défaut quand l'appelant n'en précise pas (qualité de livraison). */
export const DEFAULT_PRESET: RenderPreset = 'final';

/** Erreur structurée du rendu vidéo (étape + contexte leçon). */
export class VideoRenderError extends Error {
  readonly stage: string;
  readonly lessonId: string;

  constructor(stage: string, lessonId: string, message: string) {
    super(`video-render[${stage}] leçon ${lessonId} : ${message}`);
    this.name = 'VideoRenderError';
    this.stage = stage;
    this.lessonId = lessonId;
  }
}

/* ------------------------------------------------------------------ */
/* Plan de segments (pur)                                              */
/* ------------------------------------------------------------------ */

/** Un segment à rendre : une image tenue pour la durée de son audio. */
export interface VideoSegment {
  /** Chemin local de l'image (PNG 1920×1080). */
  imagePath: string;
  /** Chemin local du mp3 narré, ou null pour un segment silencieux (intro). */
  audioPath: string | null;
  /** Durée du segment en secondes (durée audio, ou INTRO_SECONDS). */
  seconds: number;
}

/** Durée d'une slide : audioSeconds si présent, sinon plancher raisonnable. */
export function slideSeconds(audioSeconds: number | undefined): number {
  if (typeof audioSeconds === 'number' && Number.isFinite(audioSeconds) && audioSeconds > 0) {
    return Math.round(audioSeconds * 1000) / 1000;
  }
  return 1;
}

/**
 * Somme des durées attendues du montage : intro + durées audio des slides.
 * Sert de référence à la vérification ffprobe.
 */
export function expectedDurationSeconds(segments: readonly VideoSegment[]): number {
  return segments.reduce((acc, s) => acc + s.seconds, 0);
}

/* ------------------------------------------------------------------ */
/* Estimation de durée de rendu (pure, Prompt 78)                       */
/* ------------------------------------------------------------------ */

/**
 * Facteur de vitesse relatif d'un preset par rapport à « final » (référence
 * = 1). Valeurs approximatives issues du positionnement x264 preset/CRF
 * habituel (veryfast ≈ 3× plus rapide que slow ; NVENC ≈ 4-5× plus rapide,
 * décodage matériel). Sert de repère quand l'historique par preset est
 * insuffisant (cf. estimateRenderDuration).
 */
export const PRESET_SPEED_FACTOR: Record<RenderPreset, number> = {
  draft: 3,
  final: 1,
  nvenc: 4.5,
};

/** Un échantillon d'historique : durée de rendu observée pour N slides et un preset. */
export interface RenderHistorySample {
  totalSlides: number;
  preset: RenderPreset;
  durationMs: number;
}

/**
 * Estimation PURE de la durée de rendu (ms) avant lancement, à partir de :
 *   1. l'historique de rendus passés (GenerationJob step='video-render',
 *      dénormalisé en RenderHistorySample par l'appelant — voir
 *      apps/web/src/lib/queue-estimate.ts::averageStepDurationMs pour le
 *      même pattern de requête Mongo appliqué à un step) ;
 *   2. à défaut d'historique exploitable, un repère fixe par slide
 *      (BASE_MS_PER_SLIDE) ajusté par PRESET_SPEED_FACTOR.
 * Ne jette jamais : entrées vides/incohérentes → estimation de repère.
 */
const BASE_MS_PER_SLIDE = 15_000;

export function estimateRenderDuration(
  totalSlides: number,
  preset: RenderPreset,
  history: readonly RenderHistorySample[] = [],
): number {
  const slides = Number.isFinite(totalSlides) && totalSlides > 0 ? totalSlides : 0;
  if (slides === 0) return 0;

  // 1) Historique du MÊME preset : moyenne du ms/slide observé.
  const samePreset = history.filter(
    (s) => s.preset === preset && s.totalSlides > 0 && s.durationMs > 0,
  );
  if (samePreset.length > 0) {
    const perSlide = samePreset.reduce((acc, s) => acc + s.durationMs / s.totalSlides, 0) / samePreset.length;
    return Math.round(perSlide * slides);
  }

  // 2) Historique d'un AUTRE preset : converti via le ratio de vitesse.
  const otherPreset = history.filter((s) => s.totalSlides > 0 && s.durationMs > 0);
  if (otherPreset.length > 0) {
    const perSlideByPreset = otherPreset.reduce((acc, s) => {
      const normalized = (s.durationMs / s.totalSlides) * PRESET_SPEED_FACTOR[s.preset];
      return acc + normalized;
    }, 0) / otherPreset.length;
    const perSlideTarget = perSlideByPreset / PRESET_SPEED_FACTOR[preset];
    return Math.round(perSlideTarget * slides);
  }

  // 3) Aucun historique : repère fixe ajusté par la vitesse du preset.
  return Math.round((BASE_MS_PER_SLIDE / PRESET_SPEED_FACTOR[preset]) * slides);
}

/* ------------------------------------------------------------------ */
/* Arguments ffmpeg (purs)                                             */
/* ------------------------------------------------------------------ */

/**
 * Arguments -c:v du preset choisi. x264 : -preset/-crf classiques. NVENC :
 * -preset Pn + -rc vbr + -cq (pas de CRF sur ce codec). Isolé pour être
 * réutilisé par buildSegmentArgs et buildTwoPassSegmentArgs.
 */
function codecArgs(preset: RenderPreset): string[] {
  const cfg = PRESET_CONFIG[preset];
  if (cfg.codec === 'h264_nvenc') {
    return [
      '-c:v',
      cfg.codec,
      '-preset',
      cfg.nvencPreset ?? 'p5',
      '-rc',
      cfg.nvencRateControl ?? 'vbr',
      '-cq',
      String(cfg.nvencCq ?? 19),
    ];
  }
  return ['-c:v', cfg.codec, '-preset', cfg.x264Preset ?? 'medium', '-crf', String(cfg.crf ?? 21)];
}

/**
 * Arguments ffmpeg qui transforment UNE image + (audio | silence) en un segment
 * MP4 H.264/NVENC yuv420p 1920×1080 AAC, de durée `seconds`. L'image est
 * bouclée (`-loop 1`) et bornée par `-t`. Sans audio : piste AAC silencieuse
 * (anullsrc) pour que TOUS les segments aient le même layout de flux (concat
 * sans surprise). `preset` sélectionne le couple codec/vitesse/qualité
 * (draft/final/nvenc, cf. PRESET_CONFIG) — par défaut DEFAULT_PRESET ('final'),
 * pour ne pas changer le comportement des appelants existants qui n'en
 * précisent pas.
 */
export function buildSegmentArgs(
  segment: VideoSegment,
  output: string,
  preset: RenderPreset = DEFAULT_PRESET,
): string[] {
  const args: string[] = ['-y', '-loop', '1', '-i', segment.imagePath];

  if (segment.audioPath) {
    args.push('-i', segment.audioPath);
  } else {
    // Piste silencieuse synthétique : même codec/canaux que les vraies pistes.
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  args.push(
    '-t',
    segment.seconds.toFixed(3),
    // Vidéo : pixels compatibles lecteurs, dimensions paires garanties.
    '-vf',
    `scale=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
    '-r',
    String(VIDEO_FPS),
    ...codecArgs(preset),
    '-pix_fmt',
    'yuv420p',
    // Audio : AAC stéréo 44.1k, coupé à la durée vidéo.
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ar',
    '44100',
    '-ac',
    '2',
    '-shortest',
    output,
  );
  return args;
}

/**
 * Variante 2-pass (qualité finale) : deux invocations ffmpeg partagent un
 * fichier de log (-passlogfile) et n'écrivent la sortie utilisable qu'à la
 * passe 2 (passe 1 : `-f null` / OS-null device, pas de fichier). Pertinent
 * uniquement pour x264 (CRF+2-pass) — NVENC n'a pas de mode 2-pass utile ici,
 * appeler avec un preset nvenc renvoie donc les mêmes arguments qu'un rendu
 * 1-passe (aucune régression, juste un no-op documenté).
 */
export function buildTwoPassSegmentArgs(
  segment: VideoSegment,
  output: string,
  preset: RenderPreset,
  pass: 1 | 2,
  passLogFile: string,
): string[] {
  if (PRESET_CONFIG[preset].codec === 'h264_nvenc') {
    // Pas de 2-pass pour NVENC ici : on retombe sur le rendu 1-passe standard.
    return buildSegmentArgs(segment, output, preset);
  }

  const args: string[] = ['-y', '-loop', '1', '-i', segment.imagePath];
  if (pass === 2 && segment.audioPath) {
    args.push('-i', segment.audioPath);
  } else if (pass === 2) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  }

  args.push(
    '-t',
    segment.seconds.toFixed(3),
    '-vf',
    `scale=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
    '-r',
    String(VIDEO_FPS),
    ...codecArgs(preset),
    '-pix_fmt',
    'yuv420p',
    '-pass',
    String(pass),
    '-passlogfile',
    passLogFile,
  );

  if (pass === 1) {
    // Passe 1 : analyse uniquement, pas d'audio, sortie jetée (null muxer).
    args.push('-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null');
  } else {
    args.push(
      '-c:a',
      'aac',
      '-b:a',
      AUDIO_BITRATE,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-shortest',
      output,
    );
  }
  return args;
}

/**
 * Contenu du fichier de liste du concat demuxer (chemins échappés). Chaque
 * ligne `file '…'` référence un segment MP4 déjà encodé de façon homogène.
 */
export function buildConcatFile(segmentPaths: readonly string[]): string {
  return segmentPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n')
    .concat('\n');
}

/**
 * Arguments ffmpeg du montage final par concat demuxer. La vidéo est copiée
 * (coupe franche, pas de réencodage), l'audio est réencodé AAC pour absorber
 * un éventuel fondu de raccord. -movflags +faststart pour le streaming web.
 */
export function buildConcatArgs(concatListPath: string, output: string): string[] {
  return [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-movflags',
    '+faststart',
    output,
  ];
}

/* ------------------------------------------------------------------ */
/* Vérification (pure)                                                 */
/* ------------------------------------------------------------------ */

/** Métadonnées ffprobe retenues pour la vérification. */
export interface ProbeSummary {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/**
 * Contrôle qu'un montage est conforme : durée ~= somme audio (±tolérance),
 * résolution exacte 1920×1080, piste audio présente. Retourne la liste des
 * violations (vide = conforme). Pur : testable sans ffprobe réel.
 */
export function verifyProbe(
  probe: ProbeSummary,
  expectedSeconds: number,
  tolerance = DURATION_TOLERANCE_SECONDS,
): string[] {
  const problems: string[] = [];
  if (Math.abs(probe.durationSec - expectedSeconds) > tolerance) {
    problems.push(
      `durée ${probe.durationSec.toFixed(2)}s hors tolérance (attendu ~${expectedSeconds.toFixed(2)}s ±${tolerance}s)`,
    );
  }
  if (probe.width !== VIDEO.WIDTH || probe.height !== VIDEO.HEIGHT) {
    problems.push(`résolution ${probe.width}×${probe.height} (attendu ${VIDEO.WIDTH}×${VIDEO.HEIGHT})`);
  }
  if (!probe.hasAudio) {
    problems.push('aucune piste audio détectée');
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Orchestration I/O                                                   */
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

/**
 * Timeout dur d'un appel ffmpeg SEGMENT (une slide). Filet de sécurité
 * (Prompt 128 — chaos testing) : un asset corrompu (ex. PNG invalide en entrée
 * de `-loop 1`) fait boucler ffmpeg INDÉFINIMENT sur des erreurs de décodage
 * répétées au lieu d'échouer avec un code de sortie non-zéro — constaté en
 * pratique (ffmpeg 6.0, `Invalid PNG signature` en boucle, jamais de sortie).
 * Sans ce timeout, un tel asset bloquerait le job BullMQ indéfiniment (pire
 * qu'un crash : un job zombie qui ne libère jamais son worker). 5 minutes :
 * un segment d'une slide longue (2-4 min de narration) encodé en 1080p sur une
 * machine chargée dépasse largement 2 min (constaté : timeout systématique du
 * preset 'final' sous charge) — la borne ne vise que les VRAIES boucles
 * infinies, pas les encodages légitimement lents.
 */
export const FFMPEG_SEGMENT_TIMEOUT_MS = 5 * 60_000;

/**
 * Lance ffmpeg avec les arguments donnés, borné par un timeout dur (voir
 * FFMPEG_SEGMENT_TIMEOUT_MS), tue le process encore actif si l'invocation
 * échoue ou expire (évite les processus fantômes), puis propage l'erreur.
 * Factorisation du pattern répété par les étapes segment/2-pass/concat.
 */
async function runFfmpeg(args: string[]): Promise<void> {
  const child = execa('ffmpeg', args, { timeout: FFMPEG_SEGMENT_TIMEOUT_MS });
  try {
    await child;
  } catch (err) {
    killIfActive(child);
    throw err;
  }
}

/** Cache mémoire process (une seule détection par run — ffmpeg -encoders est stable). */
let nvencAvailableCache: boolean | undefined;

/**
 * Détecte si l'encodeur GPU NVENC (h264_nvenc) est disponible dans le binaire
 * ffmpeg du PATH, via `ffmpeg -encoders`. Fallback SILENCIEUX vers x264 si
 * absent, si ffmpeg n'est pas installé, ou si la commande échoue pour toute
 * autre raison (aucune erreur ne doit interrompre le pipeline de rendu pour
 * cette simple détection de capacité). Résultat mis en cache pour le process.
 */
export async function detectNvencEncoder(): Promise<boolean> {
  if (nvencAvailableCache !== undefined) return nvencAvailableCache;
  try {
    const { stdout } = await execa('ffmpeg', ['-hide_banner', '-encoders']);
    nvencAvailableCache = /h264_nvenc/.test(stdout);
  } catch {
    nvencAvailableCache = false;
  }
  return nvencAvailableCache;
}

/** Réinitialise le cache de détection NVENC (tests). */
export function resetNvencCacheForTests(): void {
  nvencAvailableCache = undefined;
}

/**
 * Récupère (cache S3) ou génère puis met en cache le segment avatar 'intro'
 * ou 'outro' d'une SECTION (Prompt 82). Généré une seule fois par section :
 * les leçons suivantes de la même section réutilisent le fichier déjà uploadé
 * (HeadObject avant tout appel HeyGen, même logique que le cache TTS).
 * Le texte narré est minimal (titre de section) — un texte plus riche pourrait
 * être injecté plus tard sans changer la signature (paramètre `text`).
 */
async function getOrGenerateAvatarSegment(
  courseId: string,
  lessonId: string,
  sectionOrder: number,
  sectionTitle: string,
  avatarId: string,
  kind: 'intro' | 'outro',
  dest: string,
  plan: PlanId,
): Promise<void> {
  const key = storageKeys.course(courseId).avatarSegment(sectionOrder, kind);
  const cached = await downloadToFile(key, dest);
  if (cached) return;

  const text =
    kind === 'intro'
      ? `Bienvenue dans la section ${sectionTitle}.`
      : `Nous arrivons à la fin de la section ${sectionTitle}. À bientôt pour la suite !`;
  // Photo source/audio narré SadTalker non câblés ici (aucun upload dédié
  // aujourd'hui, cf. avatar.ts en-tête) : generateAvatarSegment retombe donc
  // sur HeyGen (si le plan l'autorise) ou le mock — `plan` reste transmis
  // pour que le gate HeyGen premium soit correctement appliqué.
  const result = await generateAvatarSegment(text, avatarId, { courseId, lessonId, plan });
  await uploadObject(key, await readFile(result.filePath), 'video/mp4');
  await rm(path.dirname(result.filePath), { recursive: true, force: true }).catch(() => undefined);
  // Copie locale pour l'assemblage de CETTE leçon (le fichier généré a déjà
  // été supprimé avec son dossier temporaire ci-dessus) : on re-télécharge
  // depuis le cache S3 qu'on vient d'écrire, chemin le plus simple et robuste.
  const ok = await downloadToFile(key, dest);
  if (!ok) throw new AvatarSegmentError(kind, 'échec de relecture du segment avatar juste uploadé');
}

/** Erreur dédiée (distincte de VideoRenderError) pour isoler l'origine avatar dans les logs. */
class AvatarSegmentError extends Error {
  constructor(kind: string, message: string) {
    super(`avatar-segment[${kind}] : ${message}`);
    this.name = 'AvatarSegmentError';
  }
}

/**
 * Résout le preset EFFECTIVEMENT applicable : si l'appelant demande 'nvenc'
 * mais que le GPU n'est pas disponible, retombe silencieusement sur 'final'
 * (x264 slow/CRF19, la meilleure qualité CPU) plutôt que de faire échouer le
 * rendu. Pour draft/final, retourne le preset demandé tel quel (pas de détection).
 */
export async function resolveEffectivePreset(requested: RenderPreset): Promise<RenderPreset> {
  if (requested !== 'nvenc') return requested;
  const available = await detectNvencEncoder();
  return available ? 'nvenc' : 'final';
}

/** Sonde un MP4 via ffprobe (streams v/a + durée format) → ProbeSummary. */
export async function probeVideo(file: string): Promise<ProbeSummary> {
  const { stdout } = await execa('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,width,height',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const durationSec = Number.parseFloat(parsed.format?.duration ?? 'NaN');
  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio,
  };
}

/**
 * Rend l'image d'intro (première frame D8 si le renderer motion est dispo,
 * sinon carte titre via le gabarit D7 « title ») dans `dest`. Retour : le
 * chemin de l'image. Import dynamique du slide-renderer pour ne pas charger
 * Playwright quand seul le mapping d'arguments sert (tests).
 */
async function renderIntroImage(
  courseId: string,
  lessonId: string,
  dest: string,
): Promise<string> {
  // On réutilise le pipeline de slides : une carte « title » sert d'intro. Le
  // rendu motion D8 image-par-image n'est pas requis ici (intro = image tenue).
  const { renderIntroCard } = await import('./slide-renderer.js');
  const png = await renderIntroCard(courseId, lessonId);
  await writeFile(dest, png);
  return dest;
}

export interface RenderLessonVideoResult {
  courseId: string;
  lessonId: string;
  /** Clé S3 du MP4 produit. */
  videoKey: string;
  /** Durée réelle mesurée par ffprobe (secondes). */
  durationSec: number;
  /** Nombre de segments assemblés (intro incluse). */
  segments: number;
  /** Chapitres dérivés du script (Prompt 136) — [] si aucune slide ne qualifie. */
  chapters: { offsetSec: number; title: string }[];
}

/** Options de rendu (Prompt 78) — toutes optionnelles, défauts = comportement historique. */
export interface RenderLessonVideoOptions {
  /** Preset nommé (draft/final/nvenc). Défaut : DEFAULT_PRESET ('final'). */
  preset?: RenderPreset;
  /** Active l'encodage 2-pass par segment (qualité finale, plus lent). Défaut : false. */
  twoPass?: boolean;
}

/**
 * Assemble la vidéo d'une leçon : slides PNG + audio mp3 → MP4 vérifié, uploadé
 * sous storageKeys…video(). Jette une VideoRenderError structurée à la moindre
 * étape en échec (le worker BullMQ gère alors retry + marquage GenerationJob).
 * Retourne les métadonnées du montage (durée réelle, nombre de segments).
 * `options.preset`/`options.twoPass` pilotent la vitesse/qualité d'encodage
 * (cf. PRESET_CONFIG) ; 'nvenc' retombe silencieusement sur 'final' si le GPU
 * n'est pas disponible (resolveEffectivePreset).
 */
export async function renderLessonVideo(
  courseId: string,
  lessonId: string,
  options: RenderLessonVideoOptions = {},
): Promise<RenderLessonVideoResult> {
  const requestedPreset = options.preset ?? DEFAULT_PRESET;
  const effectivePreset = await resolveEffectivePreset(requestedPreset);
  const twoPass = options.twoPass ?? false;
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new VideoRenderError('load', lessonId, 'leçon introuvable');
  if (lesson.type !== 'video') {
    throw new VideoRenderError('load', lessonId, `type « ${lesson.type} » (attendu : video)`);
  }
  const course = await Course.findById(courseId);
  if (!course) throw new VideoRenderError('load', lessonId, `cours introuvable : ${courseId}`);

  const parsed = slideScriptSchema.safeParse(lesson.script);
  if (!parsed.success) {
    throw new VideoRenderError('load', lessonId, 'script vidéo absent ou invalide (génère TTS avant le rendu)');
  }
  const script: SlideScript = parsed.data;

  const section = await Section.findById(lesson.sectionId);
  const sectionOrder = section?.order ?? 0;
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);

  // Avatar vidéo (P82) : la leçon est-elle la première/dernière de sa section ?
  // Sert à décider l'insertion des segments avatarSegment 'intro'/'outro' —
  // no-op complet (aucune requête ni changement de comportement) si
  // Course.avatarEnabled est false (défaut).
  const avatarEnabled = Boolean(course.avatarEnabled && course.avatarId);
  let isFirstLessonOfSection = false;
  let isLastLessonOfSection = false;
  let avatarPlan: PlanId = 'free';
  if (avatarEnabled) {
    const siblingOrders = await Lesson.find({ sectionId: lesson.sectionId }).select('order').lean();
    const orders = siblingOrders.map((l) => l.order);
    isFirstLessonOfSection = orders.length === 0 || lesson.order === Math.min(...orders);
    isLastLessonOfSection = orders.length === 0 || lesson.order === Math.max(...orders);
    // Plan de l'utilisateur propriétaire — gate HeyGen premium (P155, cf.
    // isHeyGenAllowedForPlan) ; repli 'free' best-effort si résolution impossible.
    avatarPlan = await planForCourse(courseId);
  }

  const dir = await mkdtemp(path.join(tmpdir(), `video-${lessonId}-`));
  try {
    // 1) Intro : image tenue VIDEO.INTRO_SECONDS, sans audio.
    const introImage = path.join(dir, 'intro.png');
    await renderIntroImage(courseId, lessonId, introImage);
    const segments: VideoSegment[] = [
      { imagePath: introImage, audioPath: null, seconds: VIDEO.INTRO_SECONDS },
    ];

    // 2) Une slide = un segment (image + audio). Slide sans audio → durée plancher.
    for (let i = 0; i < script.slides.length; i += 1) {
      const slide = script.slides[i]!;
      const imagePath = path.join(dir, `slide-${i}.png`);
      const okImage = await downloadToFile(keys.slide(i), imagePath);
      if (!okImage) {
        throw new VideoRenderError('download', lessonId, `slide PNG absente : ${keys.slide(i)} (lance le rendu des slides)`);
      }
      const audioPath = path.join(dir, `audio-${i}.mp3`);
      const okAudio = await downloadToFile(keys.audio(i), audioPath);
      segments.push({
        imagePath,
        audioPath: okAudio ? audioPath : null,
        seconds: slideSeconds(slide.audioSeconds),
      });
    }

    // 3) Encodage de chaque segment (image animée par sa durée). En 2-pass,
    // la passe 1 (analyse, sortie jetée) précède la passe 2 (sortie réelle) —
    // toutes deux annulables entre deux invocations ffmpeg (P73).
    const segmentPaths: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      // Annulation (P73) : vérifiée AVANT chaque segment — arrête le rendu
      // proprement entre deux appels ffmpeg sans tuer un encodage en cours.
      await checkCancelled(courseId);
      const out = path.join(dir, `seg-${i}.mp4`);
      try {
        if (twoPass && PRESET_CONFIG[effectivePreset].codec !== 'h264_nvenc') {
          const passLog = path.join(dir, `seg-${i}-2pass`);
          await runFfmpeg(buildTwoPassSegmentArgs(segments[i]!, out, effectivePreset, 1, passLog));
          await checkCancelled(courseId);
          await runFfmpeg(buildTwoPassSegmentArgs(segments[i]!, out, effectivePreset, 2, passLog));
        } else {
          await runFfmpeg(buildSegmentArgs(segments[i]!, out, effectivePreset));
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new VideoRenderError('encode', lessonId, `segment ${i} : ${detail}`);
      }
      segmentPaths.push(out);
    }

    // 3bis) Avatar vidéo (P82, bêta) : segments PLEIN CADRE insérés en tête
    // (intro, première leçon de section) et/ou en queue (outro, dernière
    // leçon) de la liste de segments à concaténer — cf. commentaire d'en-tête
    // « POINT D'INSERTION PRÉCIS ». Chaque segment est mis en cache par
    // section (getOrGenerateAvatarSegment) : un seul appel HeyGen par section,
    // pas par leçon. Aucun effet si avatarEnabled=false (défaut).
    let avatarExtraSeconds = 0;
    if (avatarEnabled && isFirstLessonOfSection) {
      await checkCancelled(courseId);
      const introPath = path.join(dir, 'avatar-intro.mp4');
      try {
        await getOrGenerateAvatarSegment(
          courseId,
          lessonId,
          sectionOrder,
          section?.title ?? course.title,
          course.avatarId!,
          'intro',
          introPath,
          avatarPlan,
        );
        segmentPaths.unshift(introPath);
        avatarExtraSeconds += AVATAR.SEGMENT_SECONDS;
      } catch (err) {
        // Avatar en échec ne doit jamais bloquer le rendu vidéo existant :
        // on log et on continue SANS le segment (repli sur le comportement
        // historique intro carte titre + slides).
        logger.warn({ err, sectionOrder }, 'segment avatar intro indisponible — rendu sans avatar');
      }
    }
    if (avatarEnabled && isLastLessonOfSection) {
      await checkCancelled(courseId);
      const outroPath = path.join(dir, 'avatar-outro.mp4');
      try {
        await getOrGenerateAvatarSegment(
          courseId,
          lessonId,
          sectionOrder,
          section?.title ?? course.title,
          course.avatarId!,
          'outro',
          outroPath,
          avatarPlan,
        );
        segmentPaths.push(outroPath);
        avatarExtraSeconds += AVATAR.SEGMENT_SECONDS;
      } catch (err) {
        logger.warn({ err, sectionOrder }, 'segment avatar outro indisponible — rendu sans avatar');
      }
    }

    // 4) Concaténation finale (concat demuxer, faststart). Passe par runFfmpeg
    // pour bénéficier du même timeout dur que les segments (Prompt 128) —
    // même si le risque de blocage y est moindre (copie vidéo sans décodage).
    const concatList = path.join(dir, 'concat.txt');
    await writeFile(concatList, buildConcatFile(segmentPaths), 'utf8');
    const finalPath = path.join(dir, 'lesson.mp4');
    try {
      await runFfmpeg(buildConcatArgs(concatList, finalPath));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new VideoRenderError('concat', lessonId, detail);
    }

    // 4bis) Musique de fond (Prompt 135, additif) : ne s'applique QUE si
    // Course.backgroundMusicId (ou jingleEnabled, cf. plus bas) référence une
    // piste dont le MP3 est RÉELLEMENT présent dans le stockage — sinon skip
    // silencieux (comportement historique inchangé). Sidechaincompress : la
    // narration reste le signal de contrôle, la musique « ducke » dessous.
    let mixedPath = finalPath;
    const resolvedMusic = await resolveMusicTrack(course.backgroundMusicId).catch(() => null);
    if (resolvedMusic) {
      const musicLocalPath = path.join(dir, 'music.mp3');
      const okMusic = await downloadToFile(resolvedMusic.storageKey, musicLocalPath);
      if (okMusic) {
        const mixOut = path.join(dir, 'lesson-music.mp4');
        try {
          await runFfmpeg(
            buildMusicMixArgs(mixedPath, musicLocalPath, mixOut, {
              musicVolume: course.musicVolume,
            }),
          );
          mixedPath = mixOut;
        } catch (err) {
          // Le mixage musical ne doit jamais bloquer le rendu vidéo existant :
          // on log et on continue avec la vidéo SANS musique (repli historique).
          logger.warn({ err, trackId: course.backgroundMusicId }, 'mixage musique de fond indisponible — rendu sans musique');
        }
      } else {
        logger.warn({ trackId: course.backgroundMusicId }, 'MP3 introuvable après vérification — rendu sans musique');
      }
    }

    // 4ter) Chapitres (Prompt 136, additif) : dérivés des slides "title"/
    // "section-transition" du script (offsets décalés de l'intro carte titre
    // + éventuels segments avatar en tête). Skip silencieux si aucune slide
    // ne qualifie (comportement historique inchangé — pas de fichier
    // FFMETADATA1, pas de remux). Le mux est un -c copy : coût négligeable,
    // aucune perte de qualité, aucun changement de durée.
    const introOffsetSec = VIDEO.INTRO_SECONDS + (avatarEnabled && isFirstLessonOfSection ? AVATAR.SEGMENT_SECONDS : 0);
    const chapters = lessonChaptersFromScript(script.slides, introOffsetSec);
    let chapteredPath = mixedPath;
    if (chapters.length > 0) {
      const metadataContent = buildFfmetadataChapters(chapters, expectedDurationSeconds(segments) + avatarExtraSeconds);
      if (metadataContent) {
        const metadataPath = path.join(dir, 'chapters.ffmetadata');
        await writeFile(metadataPath, metadataContent, 'utf8');
        const chapteredOut = path.join(dir, 'lesson-chapters.mp4');
        try {
          await runFfmpeg(buildChapterMuxArgs(mixedPath, metadataPath, chapteredOut));
          chapteredPath = chapteredOut;
        } catch (err) {
          // Le mux de chapitres ne doit jamais bloquer le rendu vidéo existant :
          // on log et on continue SANS chapitres (repli sur la vidéo mixée).
          logger.warn({ err, lessonId }, 'mux des chapitres indisponible — rendu sans chapitres');
        }
      }
    }

    // 5) Vérification ffprobe (durée / résolution / audio).
    const probe = await probeVideo(chapteredPath);
    const expected = expectedDurationSeconds(segments) + avatarExtraSeconds;
    const problems = verifyProbe(probe, expected);
    if (problems.length > 0) {
      throw new VideoRenderError('verify', lessonId, problems.join(' ; '));
    }

    // 6) Upload + persistance. NB : on uploade chapteredPath (retombe sur
    // mixedPath si le mux de chapitres a été sauté/a échoué, lui-même retombant
    // sur finalPath si le mixage musical a été sauté/a échoué) — PAS finalPath
    // en dur, sinon la musique de fond (P135) et les chapitres (P136) déjà
    // encodés ne seraient jamais uploadés.
    const videoKey = keys.video();
    await uploadObject(videoKey, await readFile(chapteredPath), 'video/mp4');
    lesson.assets.videoUrl = videoKey;
    lesson.durationMin = Math.max(1, Math.round((probe.durationSec / 60) * 10) / 10);
    lesson.status = 'ready';
    await lesson.save();

    // Coût de rendu : estimation compute par seconde de vidéo produite (P55).
    await recordRenderCost(
      { courseId, userId: String(course.userId) },
      probe.durationSec,
    ).catch(() => undefined);

    logger.info(
      { courseId, lessonId, videoKey, durationSec: probe.durationSec, segments: segments.length },
      'vidéo de leçon rendue et uploadée',
    );
    return {
      courseId,
      lessonId,
      videoKey,
      durationSec: probe.durationSec,
      segments: segments.length,
      chapters,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
