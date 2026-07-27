// Voix premium Chatterbox déployée sur Modal (GPU L4) — narration multilingue
// très naturelle + CLONAGE de voix personnalisée. Endpoint proxy-auth Modal
// (headers Modal-Key / Modal-Secret = tokens wk-/ws-). Payant à l'usage (GPU) :
// réservé quand explicitement activé (MODAL_TTS=true) ou pour une voix clonée.
//
// Contrat de l'endpoint (voir modal/chatterbox_tts.py) :
//   POST {MODAL_TTS_URL}  JSON { text, language, audio_prompt_b64?, context? } -> audio/wav
import { getConfig } from '../shared.js';

/** true si l'endpoint Modal TTS est configuré, activé, et non masqué par le mock. */
export function isModalTtsConfigured(): boolean {
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDERS) return false;
  const enabled = process.env.MODAL_TTS?.trim().toLowerCase() === 'true';
  return enabled && Boolean(process.env.MODAL_TTS_URL?.trim() && process.env.MODAL_KEY?.trim() && process.env.MODAL_SECRET?.trim());
}

/**
 * Synthétise `text` via Chatterbox sur Modal. `voiceSampleB64` (WAV base64)
 * optionnel active le clonage de voix. Retourne un WAV (réencodé/normalisé
 * ensuite par tts.ts comme les autres providers). Jette en cas d'échec —
 * l'appelant (media/tts.ts) décide du repli (Edge/Kokoro/silence).
 */
export async function synthesizeModalTts(
  text: string,
  locale: string,
  voiceSampleB64?: string,
  /**
   * Contexte de traçabilité (ex. `${courseId}:${lessonId}:slide${index}`) —
   * PUREMENT pour la journalisation côté Modal (`modal app logs`). Audit ESG
   * 2026-07-20 (E14) : sans lui, impossible de retrouver après coup les logs
   * du run qui a produit un défaut audio observé sur un cours donné.
   */
  context?: string,
): Promise<Buffer> {
  const url = process.env.MODAL_TTS_URL!.trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Modal-Key': process.env.MODAL_KEY!.trim(),
      'Modal-Secret': process.env.MODAL_SECRET!.trim(),
    },
    body: JSON.stringify({
      text,
      language: locale,
      ...(voiceSampleB64 ? { audio_prompt_b64: voiceSampleB64 } : {}),
      ...(context ? { context } : {}),
    }),
    // Cold-start GPU + génération : peut atteindre ~2-3 min à froid.
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Modal TTS ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
