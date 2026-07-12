// Avatar vidéo « talking head » optionnel (Prompt 82, bêta ; Prompt 155 —
// ajout du provider OSS SadTalker comme option PAR DÉFAUT).
//
// Deux providers disponibles, sélection PURE dans providers/sadtalker-provider.ts
// (selectAvatarProvider) :
//   - SadTalker (OSS, PAR DÉFAUT) — anime une photo fixe de l'instructeur sur
//     l'audio TTS déjà généré. GPU requis (cf. en-tête sadtalker-provider.ts) ;
//     qualité correcte mais perceptiblement en retrait de HeyGen (mouvements
//     de tête limités, lip-sync moins précis — voir le commentaire détaillé
//     dans sadtalker-provider.ts et le hint UI d'advanced-options-panel.tsx).
//   - HeyGen (PREMIUM, plans payants uniquement — isHeyGenAllowedForPlan) :
//     API REST simple (v2/video/generate + v1/video_status.get), clé unique,
//     statut de rendu pollable (processing/completed/failed), pas de webhook
//     obligatoire — cohérent avec le reste du worker (BullMQ poll-driven,
//     cf. review-poll.ts pour un pattern de polling similaire) ; avatarId +
//     voiceId réutilisables d'un cours à l'autre (Course.avatarId).
// D-ID et EchoMimic ont été écartés ici pour rester à deux providers maximum
// (un OSS, un premium) — le code de chaque provider est isolé dans son propre
// fichier (providers/sadtalker-provider.ts) si un troisième devait s'ajouter.
//
// LIMITE HONNÊTE ACTUELLE : il n'existe pas encore d'upload dédié de photo
// instructeur (aucun champ Course.avatarPhotoUrl) — SadTalker n'active donc
// RÉELLEMENT qu'avec un `photoUrl` fourni explicitement à generateAvatarSegment
// (voir GenerateAvatarSegmentOptions.photoUrl). Sans photo, on retombe direct
// sur HeyGen (si le plan l'autorise) puis sur le mock — jamais d'échec.
//
// MOCK : sans aucun provider utilisable (ni SadTalker+photo, ni HeyGen+plan),
// generateAvatarSegment ne fait AUCUN appel réseau — elle délègue à la carte
// titre animée déjà existante (renderIntroCard, D8) encodée en un clip
// silencieux de la durée AVATAR.SEGMENT_SECONDS, avec un log explicite du repli.
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AVATAR, VIDEO, getConfig, storageKeys, uploadObject } from '../shared.js';
import { logger } from '../queues/index.js';
import {
  isHeyGenAllowedForPlan,
  isSadTalkerConfigured,
  renderSadTalkerAvatar,
  selectAvatarProvider,
} from '../providers/sadtalker-provider.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { type PlanId } from '@sallycourse/shared';

/** Statuts renvoyés par l'API de rendu HeyGen (v1/video_status.get). */
export type HeyGenRenderStatus = 'processing' | 'completed' | 'failed' | 'pending' | 'waiting';

/** Erreur structurée du pipeline avatar (étape + contexte). */
export class AvatarGenerationError extends Error {
  readonly stage: string;

  constructor(stage: string, message: string) {
    super(`avatar[${stage}] : ${message}`);
    this.name = 'AvatarGenerationError';
    this.stage = stage;
  }
}

/** Options de génération d'un segment avatar. */
export interface GenerateAvatarSegmentOptions {
  /** Voix HeyGen (sinon AVATAR.DEFAULT_VOICE_ID). */
  voiceId?: string;
  /** Ratio d'aspect vidéo — 'landscape' (16:9, défaut) ou 'portrait'. */
  aspectRatio?: 'landscape' | 'portrait';
  /** Timeout de polling (ms). Défaut AVATAR.POLL_TIMEOUT_MS — surchargé en tests. */
  pollTimeoutMs?: number;
  /** Intervalle de polling (ms). Défaut AVATAR.POLL_INTERVAL_MS — surchargé en tests. */
  pollIntervalMs?: number;
  /** Plan de l'utilisateur propriétaire du cours — gate HeyGen (isHeyGenAllowedForPlan). */
  plan?: PlanId | string | null;
  /**
   * Photo source de l'instructeur (URL publique ou présignée), REQUISE pour
   * activer SadTalker. Absente aujourd'hui faute d'upload dédié (cf. en-tête
   * du fichier) — laisse la porte ouverte à une future Course.avatarPhotoUrl
   * sans changer cette signature.
   */
  photoUrl?: string;
  /** Audio narré déjà synthétisé (TTS), REQUIS par SadTalker (lip-sync sur cet audio). */
  narratedAudioBuffer?: Buffer;
}

export interface GenerateAvatarSegmentResult {
  /** Chemin local du MP4 produit (segment prêt à être inséré dans le montage). */
  filePath: string;
  /** Provider ayant réellement produit le segment. */
  provider: 'sadtalker' | 'heygen' | 'mock';
  /** Durée du segment, en secondes. */
  seconds: number;
}

const HEYGEN_BASE_URL = 'https://api.heygen.com';

/**
 * Corps de la requête HeyGen v2/video/generate — isolé en fonction PURE
 * (testable sans réseau) : un avatar figure en plein cadre, la voix lit le
 * texte fourni, sortie 1920×1080 (ou 1080×1920 en portrait).
 */
export function buildHeyGenGenerateRequest(
  text: string,
  avatarId: string,
  opts: GenerateAvatarSegmentOptions = {},
): Record<string, unknown> {
  const landscape = (opts.aspectRatio ?? 'landscape') === 'landscape';
  return {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: avatarId,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: text,
          voice_id: opts.voiceId ?? AVATAR.DEFAULT_VOICE_ID,
        },
      },
    ],
    dimension: landscape
      ? { width: VIDEO.WIDTH, height: VIDEO.HEIGHT }
      : { width: VIDEO.HEIGHT, height: VIDEO.WIDTH },
  };
}

/** Lance le rendu HeyGen — retourne le video_id à poller. */
async function submitHeyGenJob(
  text: string,
  avatarId: string,
  apiKey: string,
  opts: GenerateAvatarSegmentOptions,
): Promise<string> {
  const res = await fetch(`${HEYGEN_BASE_URL}/v2/video/generate`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(buildHeyGenGenerateRequest(text, avatarId, opts)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AvatarGenerationError('submit', `HeyGen ${res.status} : ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as { data?: { video_id?: string } };
  const videoId = body.data?.video_id;
  if (!videoId) throw new AvatarGenerationError('submit', 'réponse HeyGen sans video_id');
  return videoId;
}

/** Statut brut d'un job HeyGen (une invocation, pas de boucle ici — pur côté forme). */
export interface HeyGenStatusResponse {
  status: HeyGenRenderStatus;
  videoUrl?: string;
  error?: string;
}

async function fetchHeyGenStatus(videoId: string, apiKey: string): Promise<HeyGenStatusResponse> {
  const res = await fetch(`${HEYGEN_BASE_URL}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new AvatarGenerationError('poll', `HeyGen ${res.status} : ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    data?: { status?: HeyGenRenderStatus; video_url?: string; error?: { message?: string } };
  };
  return {
    status: body.data?.status ?? 'processing',
    videoUrl: body.data?.video_url,
    error: body.data?.error?.message,
  };
}

/** Sleep injectable (surchargé par les tests à fake timers via vi.advanceTimersByTimeAsync). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll le statut de rendu HeyGen jusqu'à complétion, échec, ou timeout.
 * Boucle PURE côté logique (dépendances injectées) pour être testable avec
 * des fake timers sans appel réseau réel.
 */
export async function pollHeyGenUntilDone(
  videoId: string,
  apiKey: string,
  opts: {
    pollIntervalMs: number;
    pollTimeoutMs: number;
    fetchStatus?: (videoId: string, apiKey: string) => Promise<HeyGenStatusResponse>;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  },
): Promise<string> {
  const fetchStatus = opts.fetchStatus ?? fetchHeyGenStatus;
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? sleep;
  const deadline = now() + opts.pollTimeoutMs;

  for (;;) {
    const status = await fetchStatus(videoId, apiKey);
    if (status.status === 'completed') {
      if (!status.videoUrl) throw new AvatarGenerationError('poll', 'statut completed sans video_url');
      return status.videoUrl;
    }
    if (status.status === 'failed') {
      throw new AvatarGenerationError('poll', status.error ?? 'rendu HeyGen en échec');
    }
    if (now() >= deadline) {
      throw new AvatarGenerationError('poll', `timeout après ${opts.pollTimeoutMs}ms (statut : ${status.status})`);
    }
    await wait(opts.pollIntervalMs);
  }
}

/** Télécharge le MP4 rendu vers un fichier local. */
async function downloadRenderedVideo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new AvatarGenerationError('download', `téléchargement HeyGen ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

/**
 * Génère un clip de repli « carte titre animée » (déjà existant D8 intro) :
 * réutilise renderIntroCard (image PNG) puis l'encode en MP4 silencieux de
 * AVATAR.SEGMENT_SECONDS via ffmpeg — même mécanique que l'intro de leçon
 * historique (video-render.ts), sans dépendre d'un provider externe.
 */
async function renderMockAvatarClip(
  courseId: string,
  lessonId: string,
  dest: string,
  seconds: number,
): Promise<void> {
  const { renderIntroCard } = await import('./slide-renderer.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'avatar-mock-'));
  try {
    const png = await renderIntroCard(courseId, lessonId);
    const imagePath = path.join(dir, 'card.png');
    await writeFile(imagePath, png);
    await execa('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-i',
      imagePath,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t',
      seconds.toFixed(3),
      '-vf',
      `scale=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
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
      '-shortest',
      dest,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Génère un segment vidéo « talking head » (intro ou conclusion de section).
 * Sélection du provider (selectAvatarProvider, providers/sadtalker-provider.ts) :
 *   1. SadTalker (OSS, PAR DÉFAUT) si configuré (SADTALKER_BASE_URL + GPU
 *      déclaré, cf. isSadTalkerConfigured) ET qu'une photo source est fournie
 *      (opts.photoUrl) — anime la photo sur l'audio déjà narré (opts.narratedAudioBuffer).
 *   2. HeyGen (PREMIUM) si le plan de l'utilisateur l'autorise (isHeyGenAllowedForPlan,
 *      plans payants uniquement) ET qu'un avatarId est choisi — poll jusqu'à
 *      complétion, télécharge le MP4.
 *   3. Repli carte titre animée (D8, aucun appel réseau) — toujours garanti,
 *      jamais d'échec bloquant du pipeline vidéo.
 * `courseId`/`lessonId` ne servent qu'au repli mock (renderIntroCard a besoin
 * du contexte de rendu D7).
 */
export async function generateAvatarSegment(
  text: string,
  avatarId: string,
  opts: GenerateAvatarSegmentOptions & { courseId: string; lessonId: string } = {
    courseId: '',
    lessonId: '',
  },
): Promise<GenerateAvatarSegmentResult> {
  const cfg = getConfig();
  const seconds = AVATAR.SEGMENT_SECONDS;

  const dir = await mkdtemp(path.join(tmpdir(), 'avatar-'));
  const outPath = path.join(dir, 'segment.mp4');

  const provider = selectAvatarProvider({
    plan: opts.plan,
    heygenConfigured: !cfg.MOCK_PROVIDERS && Boolean(cfg.HEYGEN_API_KEY),
    sadTalkerConfigured: isSadTalkerConfigured(),
    hasSourcePhoto: Boolean(opts.photoUrl && opts.narratedAudioBuffer),
    avatarId,
  });

  if (provider === 'sadtalker') {
    try {
      const { videoBuffer } = await renderSadTalkerAvatar(opts.photoUrl!, opts.narratedAudioBuffer!);
      await writeFile(outPath, videoBuffer);
      logger.info({ avatarId }, 'avatar SadTalker (OSS) généré');
      return { filePath: outPath, provider: 'sadtalker', seconds };
    } catch (err) {
      // Tout échec SadTalker retombe sur HeyGen (si le plan l'autorise) puis
      // sur le mock, jamais sur un blocage du rendu vidéo de la section.
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn({ avatarId, err: detail }, 'avatar SadTalker indisponible — tentative de repli');
    }
  }

  const canUseHeygen =
    !cfg.MOCK_PROVIDERS && Boolean(cfg.HEYGEN_API_KEY) && Boolean(avatarId) && isHeyGenAllowedForPlan(opts.plan);

  if (!canUseHeygen) {
    logger.info(
      { avatarId, mock: true },
      'avatar : aucun provider utilisable (SadTalker/HeyGen) — repli carte titre animée',
    );
    await renderMockAvatarClip(opts.courseId, opts.lessonId, outPath, seconds);
    return { filePath: outPath, provider: 'mock', seconds };
  }

  try {
    const videoId = await submitHeyGenJob(text, avatarId, cfg.HEYGEN_API_KEY!, opts);
    const videoUrl = await pollHeyGenUntilDone(videoId, cfg.HEYGEN_API_KEY!, {
      pollIntervalMs: opts.pollIntervalMs ?? AVATAR.POLL_INTERVAL_MS,
      pollTimeoutMs: opts.pollTimeoutMs ?? AVATAR.POLL_TIMEOUT_MS,
    });
    await downloadRenderedVideo(videoUrl, outPath);
    logger.info({ avatarId, videoId }, 'avatar HeyGen généré');
    return { filePath: outPath, provider: 'heygen', seconds };
  } catch (err) {
    // Tout échec HeyGen (soumission/polling/téléchargement) retombe sur le
    // mock plutôt que de faire échouer tout le rendu vidéo de la section.
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn({ avatarId, err: detail }, 'avatar HeyGen indisponible — repli carte titre animée');
    await renderMockAvatarClip(opts.courseId, opts.lessonId, outPath, seconds);
    return { filePath: outPath, provider: 'mock', seconds };
  }
}

/** Upload un segment avatar déjà rendu (local) vers sa clé S3 dédiée (par section). */
export async function uploadAvatarSegment(
  courseId: string,
  sectionOrder: number,
  kind: 'intro' | 'outro',
  localPath: string,
): Promise<string> {
  const key = storageKeys.course(courseId).avatarSegment(sectionOrder, kind);
  await uploadObject(key, await readFile(localPath), 'video/mp4');
  return key;
}
