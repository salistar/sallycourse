// Échantillons de référence du catalogue de voix (fix « voix multiples »
// 2026-07-26 — voir packages/shared/src/voice-catalog.ts pour la doctrine).
//
// Chaque voix du catalogue a un échantillon WAV de référence, synthétisé UNE
// fois via sa voix neuronale Edge (identité source) puis mis en cache storage
// sous voice-catalog/{id}.wav. Cet échantillon est passé en audio_prompt aux
// moteurs premium (Chatterbox, Qwen3-TTS) qui CLONENT donc la même identité
// vocale — c'est ce qui garantit une voix unique dans toute la vidéo et tout
// le cours, même quand la cascade change de moteur en cours de route.
//
// Paresseux et best-effort : si Edge est indisponible ET que l'échantillon
// n'existe pas encore, on retourne null — la synthèse continue alors sans
// épinglage (comportement d'avant ce correctif), plutôt que d'échouer la leçon.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { AUDIO, getConfig, objectExists, uploadObject, readObjectBuffer } from '../shared.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { type CatalogVoice } from '@sallycourse/shared';
import { logger } from '../queues/index.js';

/** Clé storage de l'échantillon d'une voix du catalogue. */
export function voiceSampleKey(voiceId: string): string {
  return `voice-catalog/${voiceId}.wav`;
}

/** Cache mémoire process : évite de relire S3 à chaque leçon. */
const memoryCache = new Map<string, string>();

/**
 * Synthétise l'échantillon de référence via la voix Edge source, converti en
 * WAV mono 48 kHz (AUDIO.SAMPLE_RATE — invariant de toute la chaîne audio).
 */
async function synthesizeReferenceSample(voice: CatalogVoice): Promise<Buffer> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice.edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(voice.sampleText, {});
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) throw new Error(`échantillon voix ${voice.id} : flux Edge vide`);

  const dir = await mkdtemp(path.join(tmpdir(), 'voice-sample-'));
  try {
    const mp3Path = path.join(dir, 'sample.mp3');
    const wavPath = path.join(dir, 'sample.wav');
    await writeFile(mp3Path, Buffer.concat(chunks));
    await execa('ffmpeg', ['-y', '-i', mp3Path, '-ac', '1', '-ar', String(AUDIO.SAMPLE_RATE), wavPath]);
    return await readFile(wavPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Échantillon de référence (base64 WAV) d'une voix du catalogue — depuis le
 * cache mémoire, puis storage, sinon synthétisé et mis en cache. Retourne null
 * en mode mock ou si la synthèse initiale échoue (best-effort, jamais bloquant).
 */
export async function getCatalogVoiceSampleB64(voice: CatalogVoice): Promise<string | null> {
  if (getConfig().MOCK_PROVIDERS) return null;
  const cached = memoryCache.get(voice.id);
  if (cached) return cached;

  const key = voiceSampleKey(voice.id);
  try {
    if (await objectExists(key)) {
      const b64 = (await readObjectBuffer(key)).toString('base64');
      memoryCache.set(voice.id, b64);
      return b64;
    }
    const wav = await synthesizeReferenceSample(voice);
    await uploadObject(key, wav, 'audio/wav');
    const b64 = wav.toString('base64');
    memoryCache.set(voice.id, b64);
    logger.info({ voiceId: voice.id, bytes: wav.length }, 'échantillon de voix du catalogue généré et mis en cache');
    return b64;
  } catch (err) {
    logger.warn({ voiceId: voice.id, err }, 'échantillon de voix du catalogue indisponible — narration sans épinglage');
    return null;
  }
}
