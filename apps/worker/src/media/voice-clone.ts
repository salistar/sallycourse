// Voix clonée de l'instructeur (Prompt 81) : intégration ElevenLabs Voice
// Cloning (POST /v1/voices/add, multipart) à partir d'un échantillon audio
// fourni par l'utilisateur. Le voiceId retourné est stocké sur User.clonedVoiceId
// et peut ensuite être utilisé tel quel comme Course.ttsVoice (tts.ts est déjà
// générique : resolveVoice() retourne n'importe quel id forcé, cloné ou non).
//
// MOCK_PROVIDERS ou absence de clé ELEVENLABS_API_KEY → id fictif déterministe
// (sha256 userId+label), zéro appel réseau — même contrat que media/tts.ts.
//
// Watermark de traçabilité : ElevenLabs ne propose pas de tatouage audio public
// exploitable ici ; le choix retenu (le plus simple et vérifiable) est un LOG
// de conformité — une Notification interne « voice_clone_used » est émise à
// chaque synthèse utilisant une voix clonée (voir tts.ts / tts-generation.ts),
// consultable dans le rapport de conformité admin. Documenté ici pour éviter
// toute confusion avec un watermark inaudible embarqué dans le fichier mp3.
import { createHash } from 'node:crypto';
import { getConfig } from '../shared.js';
import { logger } from '../queues/index.js';

/** Durée minimale recommandée pour un clonage de qualité correcte (secondes). */
export const MIN_SAMPLE_SECONDS = 60;

/** URL de base ElevenLabs, surchargeable (mock-server / proxy local en test). */
function elevenLabsBaseUrl(): string {
  const raw = process.env.ELEVENLABS_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : 'https://api.elevenlabs.io').replace(/\/+$/, '');
}

export interface CreateClonedVoiceResult {
  /** Identifiant de la voix (ElevenLabs réel, ou fictif déterministe en mock). */
  voiceId: string;
  /** true si produit par un vrai appel ElevenLabs, false en mock. */
  live: boolean;
}

/** Id de voix fictif déterministe (mock) — stable pour un même (userId, label). */
export function mockVoiceId(userId: string, label: string): string {
  const hash = createHash('sha256').update(`voice-clone:${userId}:${label}`).digest('hex');
  return `mock-voice-${hash.slice(0, 24)}`;
}

/**
 * Crée une voix clonée ElevenLabs à partir d'un échantillon audio. N'effectue
 * aucune validation de durée/consentement ici — c'est la responsabilité de
 * l'appelant (route API) avant d'invoquer cette fonction, qui ne fait que
 * l'appel provider (ou son mock).
 */
export async function createClonedVoice(
  userId: string,
  sampleAudioBuffer: Buffer,
  label: string,
): Promise<CreateClonedVoiceResult> {
  const cfg = getConfig();
  const mock = cfg.MOCK_PROVIDERS || !cfg.ELEVENLABS_API_KEY;

  if (mock) {
    const voiceId = mockVoiceId(userId, label);
    logger.info({ userId, voiceId }, 'Voice cloning : mock (aucune clé ElevenLabs / MOCK_PROVIDERS)');
    return { voiceId, live: false };
  }

  const form = new FormData();
  form.append('name', label);
  form.append(
    'files',
    new Blob([new Uint8Array(sampleAudioBuffer)], { type: 'audio/mpeg' }),
    'sample.mp3',
  );

  const res = await fetch(`${elevenLabsBaseUrl()}/v1/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': cfg.ELEVENLABS_API_KEY! },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs voices/add ${res.status} : ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) {
    throw new Error('ElevenLabs voices/add : réponse sans voice_id');
  }

  logger.info({ userId, voiceId: data.voice_id }, 'Voice cloning ElevenLabs créé');
  return { voiceId: data.voice_id, live: true };
}

/**
 * Supprime une voix clonée côté ElevenLabs (best-effort — n'empêche jamais la
 * suppression locale de User.clonedVoiceId même si l'appel provider échoue).
 * Mock : no-op.
 */
export async function deleteClonedVoice(voiceId: string): Promise<void> {
  const cfg = getConfig();
  const mock = cfg.MOCK_PROVIDERS || !cfg.ELEVENLABS_API_KEY || voiceId.startsWith('mock-voice-');
  if (mock) return;

  try {
    await fetch(`${elevenLabsBaseUrl()}/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': cfg.ELEVENLABS_API_KEY! },
    });
  } catch (err) {
    logger.warn({ voiceId, err }, 'Suppression ElevenLabs de la voix clonée échouée (best-effort)');
  }
}
