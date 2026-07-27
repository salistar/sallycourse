// Queue + worker dédiés de la dictée vocale de création de cours (Prompt 210).
// Même patron que le filigrane (media/watermark-worker.ts) / le blog / le
// feedback : une queue BullMQ HORS du registre typé du pipeline de génération
// (QUEUES), car la dictée n'est pas une étape de génération de cours mais une
// action à la DEMANDE (l'utilisateur enregistre sa voix, on transcrit puis on
// interprète). La mise en file vit côté web (apps/web/src/lib/queues.ts) ; ce
// module ne fait que CONSOMMER les jobs.
//
// Pipeline d'un job :
//  1. télécharge l'audio (VoiceDictation.audioKey) dans un dossier temporaire ;
//  2. transcribeAudioText() via faster-whisper (langue = whisperLangForDictation) ;
//  3. COMPRÉHENSION : callClaudeJson(dictationBriefSchema) — few-shot Darija-aware
//     rattrape la transcription imparfaite ; repli déterministe mockBriefFromTranscript
//     si MOCK_PROVIDERS / aucun provider / transcription vide ;
//  4. persiste transcript + brief + status='ready' (ou 'failed').
import { mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  VoiceDictation,
  dictationBriefSchema,
  dictationSystemPrompt,
  dictationUserPrompt,
  getConfig,
  getObjectStream,
  mockBriefFromTranscript,
  whisperLangForDictation,
  type DictationBrief,
  type DictationInputLang,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { transcribeAudioText } from '../media/transcribe.js';
import { callClaudeJson } from '../lib/claude.js';

/** Nom de la queue dédiée (miroir côté web). */
export const VOICE_INTAKE_QUEUE = 'voice-intake';
/** Nom du job d'interprétation d'une dictée. */
export const VOICE_INTAKE_JOB = 'voice-dictation';

export interface VoiceIntakeJobData {
  /** Id du document VoiceDictation à traiter. */
  dictationId: string;
}

/** Télécharge un objet S3 vers un fichier local ; retourne false si absent. */
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
 * Étape COMPRÉHENSION : transforme une transcription en brief structuré.
 * MOCK_PROVIDERS (ou clé absente) court-circuite tout appel payant via le repli
 * déterministe. callClaudeJson gère lui-même sa cascade providers + mock.
 */
async function understandTranscript(
  transcript: string,
  inputLang: DictationInputLang,
): Promise<DictationBrief> {
  const config = getConfig();
  // Repli immédiat en mode mock : évite un aller-retour LLM inutile ET garantit
  // un résultat déterministe sans aucune clé (contrat MOCK_PROVIDERS du repo).
  if (config.MOCK_PROVIDERS) {
    return mockBriefFromTranscript(transcript, inputLang);
  }
  try {
    return await callClaudeJson<DictationBrief>({
      schema: dictationBriefSchema,
      system: dictationSystemPrompt(),
      user: dictationUserPrompt(transcript, inputLang),
      // La compréhension est courte : budget de tokens réduit.
      maxTokens: 1024,
    });
  } catch (err) {
    // Un échec LLM ne doit pas perdre la dictée : repli honnête (confiance basse).
    logger.warn({ err }, 'voice-intake : compréhension LLM en échec — repli déterministe');
    return mockBriefFromTranscript(transcript, inputLang);
  }
}

/** Traite une dictée : télécharge → transcrit → interprète → persiste. */
export async function processVoiceIntake(job: Job<VoiceIntakeJobData>): Promise<{ dictationId: string; status: string }> {
  const { dictationId } = job.data;
  const dictation = await VoiceDictation.findById(dictationId);
  if (!dictation) throw new Error(`dictée introuvable : ${dictationId}`);

  dictation.status = 'transcribing';
  await dictation.save();

  const inputLang = dictation.inputLang as DictationInputLang;
  const dir = await mkdtemp(path.join(tmpdir(), `voice-${dictationId}-`));
  try {
    const audioPath = path.join(dir, 'dictation.audio');
    const downloaded = await downloadToFile(dictation.audioKey, audioPath);
    if (!downloaded) throw new Error('audio de dictée introuvable dans le stockage');

    const language = whisperLangForDictation(inputLang);
    const transcript = await transcribeAudioText(audioPath, language, dir);

    // Whisper indisponible / audio inexploitable : échec explicite plutôt qu'un
    // brief inventé (l'UI proposera de réessayer ou de saisir manuellement).
    if (!transcript) {
      dictation.status = 'failed';
      dictation.error =
        'Transcription impossible (audio inaudible ou moteur vocal indisponible). Réessayez ou saisissez le titre à la main.';
      await dictation.save();
      return { dictationId, status: 'failed' };
    }

    const brief = await understandTranscript(transcript, inputLang);
    dictation.transcript = transcript;
    dictation.brief = brief;
    dictation.status = 'ready';
    dictation.error = undefined;
    await dictation.save();

    logger.info({ dictationId, confidence: brief.confidence }, 'dictée vocale interprétée');
    return { dictationId, status: 'ready' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ dictationId, err }, 'voice-intake : échec du traitement de la dictée');
    await VoiceDictation.findByIdAndUpdate(dictationId, { status: 'failed', error: message }).catch(
      () => undefined,
    );
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

let voiceIntakeWorker: Worker<VoiceIntakeJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le worker de dictée. Idempotent. Concurrency 1 par défaut
 * (faster-whisper est CPU-bound), surchargeable par WORKER_VOICE_CONCURRENCY.
 */
export function startVoiceIntakeWorker(): void {
  if (voiceIntakeWorker) return;

  const raw = process.env.WORKER_VOICE_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  voiceIntakeWorker = new Worker<VoiceIntakeJobData>(VOICE_INTAKE_QUEUE, processVoiceIntake, {
    connection: bullConnection(),
    concurrency,
    // Transcription CPU longue : mêmes garde-fous anti-« stalled » que le rendu.
    lockDuration: 10 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  voiceIntakeWorker.on('failed', (job, err) =>
    logger.error({ queue: VOICE_INTAKE_QUEUE, jobId: job?.id, err }, 'voice-intake : job en échec'),
  );
  voiceIntakeWorker.on('error', (err) => logger.error({ queue: VOICE_INTAKE_QUEUE, err }, 'erreur worker voice-intake'));

  logger.info({ concurrency }, 'worker de dictée vocale (P210) démarré');
}

/** Arrête proprement le worker. */
export async function stopVoiceIntakeWorker(): Promise<void> {
  await voiceIntakeWorker?.close().catch(() => undefined);
  voiceIntakeWorker = null;
}
