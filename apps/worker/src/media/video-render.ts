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
  AUDIO,
  AVATAR,
  Course,
  Lesson,
  Section,
  User,
  VIDEO,
  getCatalogAvatar,
  getObjectStream,
  objectExists,
  presignedGetUrl,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  type SlideScript,
} from '../shared.js';
import { generateAvatarSegment } from './avatar.js';
import { ensureCatalogAvatarPhoto } from './avatar-catalog-photos.js';
import { synthesizeSlide } from './tts.js';
import { isModalAvatarConfigured } from '../providers/modal-avatar-provider.js';
import { buildMusicMixArgs, resolveMusicTrack } from './background-music.js';
import { buildFfmetadataChapters, buildChapterMuxArgs, lessonChaptersFromScript } from './video-chapters.js';
import { logger } from '../queues/index.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { recordAvatarCost, recordRenderCost } from '../lib/cost.js';
import { checkCancelled, killIfActive } from '../lib/cancellation.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { type PlanId } from '@sallycourse/shared';

/** Cadence de sortie du MP4 (images/seconde) — alignée sur MOTION_FPS (D8). */
export const VIDEO_FPS = VIDEO.FPS;
/** Débit audio AAC de la piste finale. */
export const AUDIO_BITRATE = '192k';

/** Amplitude du zoom lent « Ken Burns » sur chaque slide (fraction, ex. 0.04 = +4 %). */
export const KEN_BURNS_ZOOM = 0.04;
/** Suréchantillonnage du canvas avant zoompan (garde le texte net, limite le tremblement 1 px). */
const KEN_BURNS_SUPERSAMPLE = 2;

/**
 * Filtre vidéo d'une slide FIXE : suréchantillonne (lanczos ×2), applique un
 * zoom AVANT lent et centré, puis redescend à la résolution cible. Casse
 * l'aspect « diaporama figé » (audit #1 : 0 changement de plan) sans faire
 * « nager » le texte — le zoom reste centré (pas de panoramique) et le
 * suréchantillonnage absorbe le tremblement entier de pixel propre à zoompan.
 * Fonction PURE (testable). `seconds` borne le nombre de frames de la rampe.
 */
export function buildKenBurnsFilter(seconds: number): string {
  const total = Math.max(1, Math.round(Math.max(0, seconds) * VIDEO.FPS));
  const ss = KEN_BURNS_SUPERSAMPLE;
  const w = VIDEO.WIDTH;
  const h = VIDEO.HEIGHT;
  const zEnd = (1 + KEN_BURNS_ZOOM).toFixed(4);
  return (
    `scale=${w * ss}:${h * ss}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${w * ss}:${h * ss}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
    `zoompan=z='min(1+${KEN_BURNS_ZOOM}*on/${total},${zEnd})':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${total}:s=${w}x${h}:fps=${VIDEO.FPS}`
  );
}

/**
 * Chaîne de mise en forme vidéo d'une slide : mouvement Ken Burns (hors 'draft',
 * qui reste statique pour aller vite) OU mise à l'échelle statique. Toujours
 * suivie de `format=yuv420p`. Les fondus sont ajoutés PAR l'appelant.
 */
function buildSlideBaseVf(seconds: number, preset: RenderPreset): string {
  if (preset === 'draft') {
    return (
      `scale=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`
    );
  }
  return `${buildKenBurnsFilter(seconds)},format=yuv420p`;
}
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
export type RenderPreset = 'draft' | 'final' | 'nvenc' | 'qsv';

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
  /** QSV (Intel QuickSync) : preset vitesse + qualité ICQ (-global_quality, ~CRF). */
  qsvPreset?: string;
  qsvGlobalQuality?: number;
}

/** Configuration par preset — SEULE source de vérité des paramètres d'encodage. */
export const PRESET_CONFIG: Record<RenderPreset, PresetConfig> = {
  draft: { codec: 'libx264', x264Preset: 'veryfast', crf: 21 },
  // Audit vitesse 2026-07-25 (mesuré en réel : ~4,5-5,5 min d'encodage x264
  // PAR leçon de ~5 min — quasi temps réel) : 'slow' → 'medium'. À CRF égal,
  // medium est ~2× plus rapide pour une différence visuelle imperceptible sur
  // ce contenu (slides quasi statiques + zoom lent, très faciles à encoder) ;
  // le CRF 19 inchangé reste la vraie borne de qualité.
  final: { codec: 'libx264', x264Preset: 'medium', crf: 19 },
  nvenc: { codec: 'h264_nvenc', nvencPreset: 'p5', nvencRateControl: 'vbr', nvencCq: 19 },
  // QSV (Intel QuickSync, audit vitesse 2026-07-25) : encodage MATÉRIEL des
  // iGPU Intel (ex. Iris Xe de la machine de dev) — plusieurs fois plus rapide
  // que x264 logiciel, qualité ICQ 21 ≈ CRF 19-21 sur du contenu slide.
  // Sélectionné automatiquement par resolveEffectivePreset quand disponible.
  qsv: { codec: 'h264_qsv', qsvPreset: 'medium', qsvGlobalQuality: 21 },
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
  // 'final' est passé de x264 slow à medium (audit vitesse 2026-07-25) : ~2×.
  final: 2,
  nvenc: 4.5,
  qsv: 4,
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
  if (cfg.codec === 'h264_qsv') {
    // ICQ (Intelligent Constant Quality) : -global_quality joue le rôle du CRF.
    return [
      '-c:v',
      cfg.codec,
      '-preset',
      cfg.qsvPreset ?? 'medium',
      '-global_quality',
      String(cfg.qsvGlobalQuality ?? 21),
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
    args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO.SAMPLE_RATE}`);
  }

  // Transition douce : fondu d'entrée + de sortie (~0,35 s) sur CHAQUE segment
  // — le concat demuxer fait une coupe franche entre slides, visuellement
  // brutale ; le double fondu produit un « dip to black » discret. Vidéo
  // uniquement : la narration (piste continue, cf. buildLessonAudioArgs)
  // n'est jamais interrompue.
  const fadeD = Math.min(0.35, segment.seconds / 4);
  const fadeOutStart = Math.max(0, segment.seconds - fadeD);
  const fades = `,fade=t=in:st=0:d=${fadeD.toFixed(2)},fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeD.toFixed(2)}`;

  args.push(
    '-t',
    segment.seconds.toFixed(3),
    // Vidéo : mouvement Ken Burns (hors draft) + fondus, dimensions paires garanties.
    '-vf',
    `${buildSlideBaseVf(segment.seconds, preset)}${fades}`,
    '-r',
    String(VIDEO_FPS),
    ...codecArgs(preset),
    '-pix_fmt',
    'yuv420p',
    // Audio : AAC stéréo 48 kHz (standard vidéo), coupé à la durée vidéo.
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ar',
    String(AUDIO.SAMPLE_RATE),
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
    args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO.SAMPLE_RATE}`);
  }

  args.push(
    '-t',
    segment.seconds.toFixed(3),
    '-vf',
    // Le vf doit être IDENTIQUE entre passe 1 (analyse) et passe 2 (encodage)
    // pour que les stats 2-pass restent valides — buildSlideBaseVf est pur.
    buildSlideBaseVf(segment.seconds, preset),
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
      String(AUDIO.SAMPLE_RATE),
      '-ac',
      '2',
      '-shortest',
      output,
    );
  }
  return args;
}

/**
 * Arguments ffmpeg construisant la piste audio CONTINUE de la leçon : les
 * MP3 des slides (et des silences pour les segments muets — intro, slides
 * sans audio) concaténés en UN SEUL flux AAC encodé une seule fois.
 *
 * Pourquoi : encoder l'audio PAR SEGMENT puis concaténer en copie (pipeline
 * historique) accumule l'amorce silencieuse de l'encodeur AAC (~2×1024
 * échantillons ≈ 46 ms) À CHAQUE segment — sur 20+ slides, l'audio glisse
 * d'une seconde par rapport à l'image et aux sous-titres (constaté en réel).
 * Une piste unique n'a qu'une amorce, donc aucune dérive cumulative.
 */
export function buildLessonAudioArgs(segments: VideoSegment[], output: string): string[] {
  const args: string[] = ['-y'];
  for (const seg of segments) {
    if (seg.audioPath) {
      args.push('-i', seg.audioPath);
    } else {
      args.push('-f', 'lavfi', '-t', seg.seconds.toFixed(3), '-i', `anullsrc=channel_layout=stereo:sample_rate=${AUDIO.SAMPLE_RATE}`);
    }
  }
  // Micro-fondu 20 ms en entrée ET en sortie de chaque segment NARRÉ : un mp3
  // TTS qui se termine sur un échantillon non nul produit un « clic » audible
  // au joint de concaténation (discontinuité d'onde) — constaté en réel le
  // 2026-07-21 (petit bruit à la couture 1:58, persistant à travers deux
  // resynthèses de la slide : le défaut venait de l'ASSEMBLAGE, pas de la
  // voix). 20 ms est inaudible à l'oreille mais force un passage par zéro à
  // chaque bord. Le début du fade-out est calé sur seg.seconds (durée ffprobe
  // du mp3, écart réel < 5 ms). Les segments silencieux (anullsrc) restent
  // bruts : déjà à zéro numérique.
  const normalized = segments
    .map((seg, i) => {
      const base = `[${i}:a]aresample=${AUDIO.SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
      if (!seg.audioPath) return `${base}[a${i}]`;
      const outStart = Math.max(0, seg.seconds - 0.02).toFixed(3);
      return `${base},afade=t=in:st=0:d=0.02,afade=t=out:st=${outStart}:d=0.02[a${i}]`;
    })
    .join(';');
  const concatInputs = segments.map((_, i) => `[a${i}]`).join('');
  // Room tone continu sous TOUTE la narration (~-64 dBFS, bruit rose filtré,
  // seed fixe → rendu déterministe/idempotent). Efface la signature « TTS » du
  // signal : silences à zéro numérique absolu (amorce anullsrc + joints de
  // concaténation Chatterbox) et plancher de bruit bimodal — un micro réel a
  // toujours un lit d'air continu (~-65/-70 dB mesuré sur des cours humains).
  // amix normalize=0 : la narration garde exactement son niveau (-16.7 LUFS).
  // amplitude=0.0025 ≈ RMS -66 dBFS après filtrage (mesuré) — calé sur le lit
  // d'air des enregistrements micro humains de référence (-67/-70 dB).
  const roomTone =
    `anoisesrc=colour=pink:sample_rate=${AUDIO.SAMPLE_RATE}:amplitude=0.0025:seed=42[rt0];` +
    '[rt0]aformat=sample_fmts=fltp:channel_layouts=stereo,highpass=f=50,lowpass=f=8000[rt]';
  args.push(
    '-filter_complex',
    `${normalized};${concatInputs}concat=n=${segments.length}:v=0:a=1[narr];${roomTone};[narr][rt]amix=inputs=2:duration=first:normalize=0[out]`,
    '-map',
    '[out]',
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ar',
    String(AUDIO.SAMPLE_RATE),
    '-ac',
    '2',
    output,
  );
  return args;
}

/**
 * Remplace la piste audio d'une vidéo par la piste continue (copie vidéo,
 * copie audio — aucun réencodage, opération quasi instantanée).
 */
export function buildAudioReplaceArgs(videoPath: string, audioPath: string, output: string): string[] {
  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    '-shortest',
    output,
  ];
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
// 5 → 8 min (audit vitesse 2026-07-25) : sous forte charge machine, un segment
// x264 légitime dépassait les 5 min → timeout → toute la leçon rejouée par
// BullMQ (10+ min perdues). Avec l'encodeur matériel/medium le cas devient
// rare, mais la marge évite le pire scénario (retry complet) quand il survient.
export const FFMPEG_SEGMENT_TIMEOUT_MS = 8 * 60_000;

/**
 * Lance ffmpeg avec les arguments donnés, borné par un timeout dur (par défaut
 * FFMPEG_SEGMENT_TIMEOUT_MS), tue le process encore actif si l'invocation échoue
 * ou expire (évite les processus fantômes), puis propage l'erreur. Le timeout
 * est surchargeable pour les rendus longs (ex. screencast uploadé, ré-encodage
 * pleine longueur d'un enregistrement de plusieurs minutes).
 */
export async function runFfmpeg(args: string[], timeoutMs: number = FFMPEG_SEGMENT_TIMEOUT_MS): Promise<void> {
  const child = execa('ffmpeg', args, { timeout: timeoutMs });
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
 * Détecte si l'encodage GPU NVENC (h264_nvenc) FONCTIONNE réellement sur cette
 * machine. Durci à l'audit vitesse 2026-07-25 : l'ancienne détection (grep de
 * `ffmpeg -encoders`) répondait true dès que le BUILD ffmpeg incluait
 * l'encodeur — y compris sans aucun GPU NVIDIA (cas de la machine de dev,
 * iGPU Intel seul), ce qui aurait fait échouer tous les encodages depuis que
 * resolveEffectivePreset monte automatiquement vers le matériel. Comme pour
 * QSV : UN mini-encodage réel (0,1 s de mire lavfi), une fois par process.
 * Fallback SILENCIEUX (false) sur toute erreur.
 */
export async function detectNvencEncoder(): Promise<boolean> {
  if (nvencAvailableCache !== undefined) return nvencAvailableCache;
  try {
    await execa(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=320x240:rate=30', '-c:v', 'h264_nvenc', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'],
      { timeout: 20_000 },
    );
    nvencAvailableCache = true;
  } catch {
    nvencAvailableCache = false;
  }
  return nvencAvailableCache;
}

/** Réinitialise le cache de détection NVENC (tests). */
export function resetNvencCacheForTests(): void {
  nvencAvailableCache = undefined;
}

/** Cache mémoire process de la détection QSV (un seul test d'encodage par run). */
let qsvAvailableCache: boolean | undefined;

/**
 * Détecte si l'encodage MATÉRIEL Intel QuickSync (h264_qsv) fonctionne
 * réellement sur cette machine (audit vitesse 2026-07-25). Contrairement à
 * NVENC, la simple présence de l'encodeur dans `ffmpeg -encoders` ne suffit
 * pas (le build l'inclut même sans iGPU Intel) : on fait UN mini-encodage
 * réel (0,1 s de mire lavfi, sortie jetée) — ~1 s, une seule fois par process.
 * Fallback SILENCIEUX (false) sur toute erreur : la détection ne doit jamais
 * faire échouer un rendu.
 */
export async function detectQsvEncoder(): Promise<boolean> {
  if (qsvAvailableCache !== undefined) return qsvAvailableCache;
  try {
    await execa(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=320x240:rate=30', '-c:v', 'h264_qsv', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'],
      { timeout: 20_000 },
    );
    qsvAvailableCache = true;
  } catch {
    qsvAvailableCache = false;
  }
  return qsvAvailableCache;
}

/** Réinitialise le cache de détection QSV (tests). */
export function resetQsvCacheForTests(): void {
  qsvAvailableCache = undefined;
}

/**
 * Récupère (cache S3) ou génère puis met en cache le segment avatar 'intro'
 * ou 'outro' d'une SECTION (Prompt 82). Généré une seule fois par section :
 * les leçons suivantes de la même section réutilisent le fichier déjà uploadé
 * (HeadObject avant tout appel HeyGen, même logique que le cache TTS).
 * Le texte narré est minimal (titre de section) — un texte plus riche pourrait
 * être injecté plus tard sans changer la signature (paramètre `text`).
 */
/** Options d'activation de l'avatar RÉEL (Ditto) : photo présentateur + voix. */
interface AvatarSegmentInputs {
  /** Clé S3 de la photo de visage (storageKeys.avatarFace) — active Ditto. */
  photoKey?: string;
  /** Langue de la narration intro/outro (voix + audio_prompt). */
  locale: string;
  /** Voix forcée (Course.ttsVoice) pour la narration du segment. */
  voice?: string;
  /** Vitesse de narration (Course.narrationSpeed). */
  narrationSpeed?: number;
}

/**
 * Cadre/étire un clip avatar (durée variable côté Ditto) à EXACTEMENT `seconds`
 * et au format vidéo cible : le montage suppose une durée fixe par segment
 * (offsets chapitres + vérification de durée). tpad clone la dernière image si
 * trop court, `-t` coupe si trop long ; apad complète l'audio en silence.
 */
/**
 * Export vertical 9:16 (1080×1920, P167 — format shorts) : la vidéo 16:9 est
 * centrée sur un fond flou d'elle-même (rendu « reels » propre, sans bandes
 * noires). Audio copié. Fonction PURE (arguments ffmpeg) — testable.
 */
export function buildVerticalExportArgs(src: string, dest: string): string[] {
  return [
    '-y',
    '-i',
    src,
    '-filter_complex',
    '[0:v]split=2[bg][fg];' +
      '[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[bgb];' +
      '[fg]scale=1080:-2[fgs];' +
      '[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]',
    '-map',
    '[v]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    dest,
  ];
}

export function buildAvatarNormalizeArgs(src: string, dest: string, seconds: number): string[] {
  return [
    '-y',
    '-i',
    src,
    '-vf',
    `tpad=stop_mode=clone:stop_duration=${seconds.toFixed(3)},scale=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
    '-af',
    'apad',
    '-t',
    seconds.toFixed(3),
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
    '128k',
    dest,
  ];
}

async function getOrGenerateAvatarSegment(
  courseId: string,
  lessonId: string,
  sectionOrder: number,
  sectionTitle: string,
  avatarId: string,
  kind: 'intro' | 'outro',
  dest: string,
  plan: PlanId,
  inputs: AvatarSegmentInputs,
): Promise<void> {
  const key = storageKeys.course(courseId).avatarSegment(sectionOrder, kind);
  const cached = await downloadToFile(key, dest);
  if (cached) return;

  // Texte LOCALISÉ selon la langue du cours (audit hardcoding 2026-07-26 :
  // un cours en/ar recevait une intro avatar parlée en français).
  const AVATAR_TEXTS: Record<string, { intro: (s: string) => string; outro: (s: string) => string }> = {
    fr: {
      intro: (s) => `Bienvenue dans la section ${s}.`,
      outro: (s) => `Nous arrivons à la fin de la section ${s}. À bientôt pour la suite !`,
    },
    en: {
      intro: (s) => `Welcome to the section ${s}.`,
      outro: (s) => `We have reached the end of the section ${s}. See you soon for the next one!`,
    },
    ar: {
      intro: (s) => `مرحبا بكم في قسم ${s}.`,
      outro: (s) => `وصلنا إلى نهاية قسم ${s}. إلى اللقاء في القسم القادم!`,
    },
  };
  const texts = AVATAR_TEXTS[inputs.locale] ?? AVATAR_TEXTS.fr!;
  const text = kind === 'intro' ? texts.intro(sectionTitle) : texts.outro(sectionTitle);

  // Avatar RÉEL (Ditto/Modal) : nécessite une photo de présentateur + un audio
  // narré. On synthétise le texte (voix du cours, éventuellement clonée) et on
  // presigne la photo. Sans photo (ou Modal indisponible), generateAvatarSegment
  // retombe sur SadTalker/HeyGen (selon le plan) puis sur le mock — jamais d'échec.
  let photoUrl: string | undefined;
  let narratedAudioBuffer: Buffer | undefined;
  if (isModalAvatarConfigured() && inputs.photoKey && (await objectExists(inputs.photoKey))) {
    try {
      photoUrl = await presignedGetUrl(inputs.photoKey);
      const { cacheKey } = await synthesizeSlide({
        text,
        locale: inputs.locale,
        voice: inputs.voice,
        speed: inputs.narrationSpeed,
        plan,
      });
      const audioTmp = `${dest}.narration.mp3`;
      if (await downloadToFile(cacheKey, audioTmp)) narratedAudioBuffer = await readFile(audioTmp);
    } catch (err) {
      logger.warn({ err, sectionOrder }, 'avatar : préparation photo/audio échouée — repli providers');
      photoUrl = undefined;
      narratedAudioBuffer = undefined;
    }
  }

  const result = await generateAvatarSegment(text, avatarId, {
    courseId,
    lessonId,
    plan,
    ...(photoUrl ? { photoUrl } : {}),
    ...(narratedAudioBuffer ? { narratedAudioBuffer } : {}),
  });

  // Coût avatar instrumenté (audit coûts 2026-07-26) : uniquement les
  // providers GPU/payants — le mock (carte titre) est gratuit. Best-effort.
  if (result.provider !== 'mock') {
    await recordAvatarCost({ courseId }, result.seconds, result.provider).catch(() => undefined);
  }

  // Normalise à AVATAR.SEGMENT_SECONDS avant mise en cache (durée fixe attendue
  // par le montage). Repli : uploade le clip brut si la normalisation échoue.
  const normalized = `${result.filePath}.norm.mp4`;
  try {
    await runFfmpeg(buildAvatarNormalizeArgs(result.filePath, normalized, AVATAR.SEGMENT_SECONDS));
    await uploadObject(key, await readFile(normalized), 'video/mp4');
  } catch (err) {
    logger.warn({ err, sectionOrder }, 'avatar : normalisation durée échouée — clip brut conservé');
    await uploadObject(key, await readFile(result.filePath), 'video/mp4');
  }
  await rm(path.dirname(result.filePath), { recursive: true, force: true }).catch(() => undefined);
  // Copie locale pour l'assemblage de CETTE leçon : on re-télécharge depuis le
  // cache S3 qu'on vient d'écrire, chemin le plus simple et robuste.
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
 * Résout le preset EFFECTIVEMENT applicable.
 * - 'nvenc' demandé : NVENC si dispo, sinon repli QSV, sinon 'final' (CPU).
 * - 'qsv' demandé : QSV si dispo, sinon 'final'.
 * - 'final' demandé (le défaut de tous les rendus de livraison) : BASCULE
 *   AUTOMATIQUE vers un encodeur MATÉRIEL disponible (nvenc → qsv) — audit
 *   vitesse 2026-07-25 : l'encodage x264 logiciel prenait ~5 min PAR leçon de
 *   5 min alors que la machine de dev a un iGPU Intel QSV inutilisé.
 *   Débrayable via VIDEO_HW_ENCODER=off (retour au x264 CPU pur).
 * - 'draft' : inchangé (veryfast CPU, déjà rapide et sans détection à payer).
 */
export async function resolveEffectivePreset(requested: RenderPreset): Promise<RenderPreset> {
  const hwDisabled = process.env.VIDEO_HW_ENCODER?.trim().toLowerCase() === 'off';
  if (requested === 'draft') return 'draft';
  if (hwDisabled) return requested === 'nvenc' || requested === 'qsv' ? 'final' : requested;
  if (requested === 'nvenc') {
    if (await detectNvencEncoder()) return 'nvenc';
    return (await detectQsvEncoder()) ? 'qsv' : 'final';
  }
  if (requested === 'qsv') {
    return (await detectQsvEncoder()) ? 'qsv' : 'final';
  }
  // 'final' : monte automatiquement vers le matériel disponible.
  if (await detectNvencEncoder()) return 'nvenc';
  if (await detectQsvEncoder()) return 'qsv';
  return 'final';
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
  // Avatar activé si le cours le demande ET qu'on a de quoi le produire : une
  // photo de présentateur (Ditto/Modal, préféré) OU un avatarId HeyGen.
  let avatarFaceKey: string | undefined;
  if (course.avatarEnabled) {
    const owner = await User.findById(course.userId).select('avatarFaceUploadedAt').lean();
    if (owner?.avatarFaceUploadedAt) avatarFaceKey = storageKeys.avatarFace(String(course.userId));
    // Avatar du CATALOGUE (2026-07-26) : sans photo uploadée par l'auteur, un
    // avatarId du catalogue fournit son portrait généré (cache storage) — le
    // chemin Ditto s'active donc aussi pour les avatars « prêts à l'emploi ».
    // La photo de l'auteur garde la priorité (c'est SON cours).
    if (!avatarFaceKey) {
      const catalogAvatar = getCatalogAvatar(course.avatarId);
      if (catalogAvatar) {
        const key = await ensureCatalogAvatarPhoto(catalogAvatar);
        if (key) avatarFaceKey = key;
      }
    }
  }
  const avatarEnabled = Boolean(course.avatarEnabled) && Boolean(course.avatarId || avatarFaceKey);
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
    // Téléchargements EN PARALLÈLE (audit optimisations 2026-07-26, item #4 :
    // PNG+MP3 par slide et toutes les slides étaient tirées en série) — temps de
    // préparation ∝ nb de slides divisé. L'ordre des segments est préservé
    // (construction dans l'ordre après collecte).
    const downloads = await Promise.all(
      script.slides.map(async (_slide, i) => {
        const imagePath = path.join(dir, `slide-${i}.png`);
        const audioPath = path.join(dir, `audio-${i}.mp3`);
        const [okImage, okAudio] = await Promise.all([
          downloadToFile(keys.slide(i), imagePath),
          downloadToFile(keys.audio(i), audioPath),
        ]);
        return { i, imagePath, audioPath, okImage, okAudio };
      }),
    );
    for (const d of downloads) {
      if (!d.okImage) {
        throw new VideoRenderError('download', lessonId, `slide PNG absente : ${keys.slide(d.i)} (lance le rendu des slides)`);
      }
      segments.push({
        imagePath: d.imagePath,
        audioPath: d.okAudio ? d.audioPath : null,
        seconds: slideSeconds(script.slides[d.i]!.audioSeconds),
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
          course.avatarId ?? '',
          'intro',
          introPath,
          avatarPlan,
          { photoKey: avatarFaceKey, locale: course.locale, voice: course.ttsVoice, narrationSpeed: course.narrationSpeed },
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
          course.avatarId ?? '',
          'outro',
          outroPath,
          avatarPlan,
          { photoKey: avatarFaceKey, locale: course.locale, voice: course.ttsVoice, narrationSpeed: course.narrationSpeed },
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

    // 4ter) Piste audio CONTINUE (anti-dérive) : remplace l'audio concaténé
    // par segments (amorces AAC cumulées → décalage audio/vidéo/sous-titres
    // croissant) par un flux unique construit depuis les MP3 originaux — voir
    // buildLessonAudioArgs. Réservé au flux standard : les segments avatar
    // (P82) embarquent leur PROPRE narration, incompatible avec ce remplacement.
    let syncedPath = finalPath;
    if (avatarExtraSeconds === 0) {
      try {
        const narrationPath = path.join(dir, 'narration.m4a');
        await runFfmpeg(buildLessonAudioArgs(segments, narrationPath));
        const remuxed = path.join(dir, 'lesson-sync.mp4');
        await runFfmpeg(buildAudioReplaceArgs(finalPath, narrationPath, remuxed));
        syncedPath = remuxed;
      } catch (err) {
        // Best-effort : en cas d'échec on garde le montage historique (léger
        // décalage) plutôt que d'échouer tout le rendu.
        logger.warn({ err, lessonId }, 'piste audio continue indisponible — audio par segments conservé');
      }
    }

    // 4bis) Musique de fond (Prompt 135, additif) : ne s'applique QUE si
    // Course.backgroundMusicId (ou jingleEnabled, cf. plus bas) référence une
    // piste dont le MP3 est RÉELLEMENT présent dans le stockage — sinon skip
    // silencieux (comportement historique inchangé). Sidechaincompress : la
    // narration reste le signal de contrôle, la musique « ducke » dessous.
    let mixedPath = syncedPath;
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

    // 5) Vérification ffprobe (durée / résolution / audio). La durée ATTENDUE
    // est une ESTIMATION (somme des durées de segment). Avec des segments avatar
    // (bêta), la narration incrustée introduit une variance que l'estimation ne
    // capture pas (clips normalisés + intro/outro de section) : on élargit alors
    // la tolérance de durée, tout en gardant STRICTS les contrôles résolution +
    // présence audio (les vrais indicateurs d'un rendu cassé). Sans avatar,
    // tolérance historique inchangée.
    const probe = await probeVideo(chapteredPath);
    const expected = expectedDurationSeconds(segments) + avatarExtraSeconds;
    const durationTolerance =
      avatarExtraSeconds > 0 ? DURATION_TOLERANCE_SECONDS + AVATAR.SEGMENT_SECONDS * 6 : DURATION_TOLERANCE_SECONDS;
    const problems = verifyProbe(probe, expected, durationTolerance);
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

    // Version verticale 9:16 (P167, format shorts) — additive, best-effort : une
    // panne d'export ne bloque jamais la leçon (la vidéo 16:9 reste la sortie
    // principale). Uniquement si Course.advancedParams.generateVertical.
    if (course.advancedParams?.generateVertical) {
      try {
        const verticalPath = path.join(dir, 'lesson-vertical.mp4');
        await runFfmpeg(buildVerticalExportArgs(chapteredPath, verticalPath));
        await uploadObject(keys.videoVertical(), await readFile(verticalPath), 'video/mp4');
        lesson.assets.videoVerticalUrl = keys.videoVertical();
        logger.info({ lessonId }, 'export vertical 9:16 généré');
      } catch (err) {
        logger.warn({ err, lessonId }, 'export vertical 9:16 indisponible — rendu sans version verticale');
      }
    }

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
