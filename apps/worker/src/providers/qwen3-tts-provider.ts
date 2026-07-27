// Voix premium Qwen3-TTS déployée sur Modal (GPU L4) — ajout ADDITIF suite à
// l'audit qualité modèles du 2026-07-22 (voir modal/qwen3_tts.py) : ne
// remplace PAS Chatterbox (modal-tts-provider.ts), les deux coexistent —
// Course.ttsEngine / le bouton « switch » (audio-repair.ts) choisit lequel
// est tenté en premier dans la cascade (media/tts.ts).
//
// Contrat de l'endpoint (voir modal/qwen3_tts.py) — IDENTIQUE à Chatterbox :
//   POST {MODAL_QWEN3_TTS_URL}  JSON { text, language, audio_prompt_b64?, context? } -> audio/wav
import { getConfig } from '../shared.js';

/** true si l'endpoint Modal Qwen3-TTS est configuré, activé, et non masqué par le mock. */
export function isQwen3TtsConfigured(): boolean {
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDERS) return false;
  const enabled = process.env.MODAL_QWEN3_TTS?.trim().toLowerCase() === 'true';
  return (
    enabled &&
    Boolean(
      process.env.MODAL_QWEN3_TTS_URL?.trim() && process.env.MODAL_KEY?.trim() && process.env.MODAL_SECRET?.trim(),
    )
  );
}

/**
 * Synthétise `text` via Qwen3-TTS sur Modal. `voiceSampleB64` (WAV base64)
 * optionnel active le clonage de voix (checkpoint Base, embedding de locuteur
 * seul — voir doc de modal/qwen3_tts.py). Retourne un WAV (réencodé/normalisé
 * ensuite par tts.ts comme les autres providers). Jette en cas d'échec —
 * l'appelant (media/tts.ts) décide du repli.
 */
export async function synthesizeQwen3Tts(
  text: string,
  locale: string,
  voiceSampleB64?: string,
  context?: string,
): Promise<Buffer> {
  const url = process.env.MODAL_QWEN3_TTS_URL!.trim();
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
    // Cold-start GPU (2 checkpoints possibles) + génération : comme Chatterbox.
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Modal Qwen3-TTS ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
