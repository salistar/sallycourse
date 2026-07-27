// Transcription Whisper large-v3 déployée sur Modal (GPU L4) — bien plus précise
// et rapide que le faster-whisper 'small' CPU, en particulier pour la darija /
// l'arabe. Endpoint proxy-auth Modal (headers Modal-Key / Modal-Secret, mêmes
// tokens que Chatterbox/Ditto). Payant à l'usage (GPU) : activé via MODAL_WHISPER.
//
// Contrat de l'endpoint (voir modal/whisper_transcribe.py) :
//   POST {MODAL_WHISPER_URL}  JSON { audio_b64, language? }
//     -> JSON { text, language, segments: [{ start, end, text }] }
import { getConfig } from '../shared.js';
import type { WhisperSegment } from '../media/subtitles.js';

/** true si l'endpoint Modal Whisper est configuré, activé, et non masqué par le mock. */
export function isModalWhisperConfigured(): boolean {
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDERS) return false;
  const enabled = process.env.MODAL_WHISPER?.trim().toLowerCase() === 'true';
  return (
    enabled &&
    Boolean(
      process.env.MODAL_WHISPER_URL?.trim() &&
        process.env.MODAL_KEY?.trim() &&
        process.env.MODAL_SECRET?.trim(),
    )
  );
}

/**
 * Transcrit un média (déjà lu en base64) via Whisper large-v3 sur Modal.
 * Retourne les segments {start,end,text}. Jette en cas d'échec — l'appelant
 * (media/transcribe.ts) retombe alors sur le faster-whisper CPU.
 */
export async function transcribeModalWhisper(
  audioB64: string,
  language?: string,
): Promise<WhisperSegment[]> {
  const url = process.env.MODAL_WHISPER_URL!.trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Modal-Key': process.env.MODAL_KEY!.trim(),
      'Modal-Secret': process.env.MODAL_SECRET!.trim(),
    },
    body: JSON.stringify({ audio_b64: audioB64, ...(language ? { language } : {}) }),
    // Cold-start GPU + transcription d'une longue vidéo : peut atteindre plusieurs minutes.
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Modal Whisper ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as { segments?: unknown };
  const segments = Array.isArray(data.segments) ? data.segments : [];
  return segments.filter(
    (s): s is WhisperSegment =>
      typeof (s as WhisperSegment)?.start === 'number' &&
      typeof (s as WhisperSegment)?.end === 'number' &&
      typeof (s as WhisperSegment)?.text === 'string',
  );
}
