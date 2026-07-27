// Processor de la queue auxiliaire « manual-audio-intake » (Lot 4, plan
// 2026-07-20) : l'auteur a enregistré au micro ou uploadé un fichier audio
// pour UNE slide (route web, upload multipart brut) ; ce job normalise le
// fichier (mêmes réglages que le TTS — media/tts.ts : loudnorm -16 LUFS,
// 48 kHz, mp3), mesure sa durée réelle (ffprobe) et persiste le résultat sur
// la slide. N'ENFILE PAS de re-render : appliquer l'enregistrement à la vidéo
// est une action DISTINCTE (regenerate render-only, comme l'image de slide,
// Lot 3) — l'auteur peut ainsi ré-enregistrer plusieurs fois avant de payer un
// seul re-render. `tts-generation.ts` copie ensuite `manualAudioKey` vers
// `audio(i)` AU LIEU de resynthétiser (voir son `runStep`) : l'enregistrement
// survit donc à toute régénération ultérieure de la leçon.
import type { Job } from 'bullmq';
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AUDIO, Lesson, Section, getObjectStream, slideScriptSchema, storageKeys, uploadObject } from '../shared.js';
import { logger } from '../queues/index.js';
import { probeDurationSeconds } from '../media/tts.js';

export interface ManualAudioIntakeJobData {
  courseId: string;
  lessonId: string;
  index: number;
}

export interface ManualAudioIntakeResult {
  courseId: string;
  lessonId: string;
  index: number;
  audioKey: string;
  audioSeconds: number;
}

/** Nom de la queue BullMQ — miroir de apps/web/src/lib/queues.ts (MANUAL_AUDIO_INTAKE_QUEUE). */
export const MANUAL_AUDIO_INTAKE_QUEUE = 'manual-audio-intake';
/** Nom du job — miroir de apps/web/src/lib/queues.ts (MANUAL_AUDIO_INTAKE_JOB). */
export const MANUAL_AUDIO_INTAKE_JOB = 'manual-audio-intake-slide';

/** jobId déterministe par (leçon × index) : deux slides de la même leçon peuvent s'intégrer en parallèle sans collision. */
export function manualAudioIntakeJobId(lessonId: string, index: number): string {
  return `${MANUAL_AUDIO_INTAKE_JOB}_${lessonId}_${index}`;
}

/** Télécharge une clé de stockage vers un fichier local. */
async function downloadToFile(key: string, dest: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of await getObjectStream(key)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await writeFile(dest, Buffer.concat(chunks));
}

/** Persiste un échec (best-effort — ne jette jamais, appelé depuis un catch). */
async function markFailed(lessonId: string, index: number): Promise<void> {
  try {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return;
    const parsed = slideScriptSchema.safeParse(lesson.script);
    if (!parsed.success) return;
    const slide = parsed.data.slides[index];
    if (!slide) return;
    slide.audioStatus = 'failed';
    lesson.script = parsed.data;
    lesson.markModified('script');
    await lesson.save();
  } catch (err) {
    logger.warn({ lessonId, index, err }, 'manual-audio-intake : impossible de persister le statut d’échec');
  }
}

/** Processor de la queue « manual-audio-intake » (un job = une slide d'une leçon). */
export async function processManualAudioIntake(job: Job<ManualAudioIntakeJobData>): Promise<ManualAudioIntakeResult> {
  const { courseId, lessonId, index } = job.data;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'video') {
    throw new Error(`manual-audio-intake : leçon ${lessonId} de type « ${lesson.type} » (attendu : video)`);
  }

  const parsed = slideScriptSchema.safeParse(lesson.script);
  if (!parsed.success) throw new Error(`script vidéo absent ou invalide pour la leçon ${lessonId}`);
  const script = parsed.data;
  const slide = script.slides[index];
  if (!slide) throw new Error(`manual-audio-intake : index ${index} hors bornes pour la leçon ${lessonId}`);

  const section = await Section.findById(lesson.sectionId).select('order').lean();
  if (!section) throw new Error(`section introuvable pour la leçon ${lessonId}`);

  const dir = await mkdtemp(path.join(tmpdir(), 'manual-audio-'));
  try {
    const lessonKeys = storageKeys.course(courseId).lesson(section.order, lesson.order);
    const rawKey = lessonKeys.manualAudioRaw(index);
    const rawPath = path.join(dir, 'raw-input');
    await downloadToFile(rawKey, rawPath);

    // Même chaîne de normalisation que le TTS (media/tts.ts normalizeLoudness) :
    // loudnorm -16 LUFS, ré-échantillonnage 48 kHz, réencodage mp3 — la voix
    // manuelle et la voix synthétisée sortent au même niveau/format.
    const normPath = path.join(dir, 'normalized.mp3');
    await execa('ffmpeg', [
      '-y',
      '-i',
      rawPath,
      '-af',
      `loudnorm=I=${AUDIO.TARGET_LUFS}:TP=-1.5:LRA=11`,
      '-ar',
      String(AUDIO.SAMPLE_RATE),
      '-b:a',
      '128k',
      '-codec:a',
      'libmp3lame',
      normPath,
    ]);
    const seconds = await probeDurationSeconds(normPath);

    const finalKey = lessonKeys.manualAudio(index);
    await uploadObject(finalKey, await readFile(normPath), 'audio/mpeg');

    slide.manualAudioKey = finalKey;
    slide.audioSource = 'manual';
    slide.audioStatus = 'ready';
    slide.audioSeconds = seconds;
    script.slides[index] = slide;
    lesson.script = script;
    lesson.markModified('script');
    await lesson.save();

    logger.info({ courseId, lessonId, index, seconds }, 'manual-audio-intake : enregistrement normalisé et persisté');
    return { courseId, lessonId, index, audioKey: finalKey, audioSeconds: seconds };
  } catch (err) {
    logger.error({ courseId, lessonId, index, err }, 'échec de l’intégration audio manuelle');
    await markFailed(lessonId, index);
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
