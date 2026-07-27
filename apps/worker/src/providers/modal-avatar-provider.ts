// Avatar « talking-head » Ditto déployé sur Modal (GPU A10G) — génère une vidéo
// MP4 de tête parlante à partir d'UNE photo de visage + un WAV de narration.
// Endpoint proxy-auth Modal (headers Modal-Key / Modal-Secret). Payant à l'usage
// (GPU) : réservé quand explicitement activé (MODAL_AVATAR=true) et qu'un cours
// a l'avatar activé + une photo de présentateur.
//
// Contrat de l'endpoint (voir modal/ditto_avatar.py) :
//   POST {MODAL_AVATAR_URL}  JSON { image_b64, audio_b64 } -> video/mp4
import { getConfig } from '../shared.js';

/** true si l'endpoint Modal avatar est configuré, activé, et non masqué par le mock. */
export function isModalAvatarConfigured(): boolean {
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDERS) return false;
  const enabled = process.env.MODAL_AVATAR?.trim().toLowerCase() === 'true';
  return (
    enabled &&
    Boolean(
      process.env.MODAL_AVATAR_URL?.trim() && process.env.MODAL_KEY?.trim() && process.env.MODAL_SECRET?.trim(),
    )
  );
}

/**
 * Génère une vidéo de tête parlante (MP4, audio muxé) à partir d'une photo de
 * visage frontale et d'un WAV de narration, tous deux en base64. Cold-start GPU
 * + téléchargement des poids au premier appel : timeout large. Jette en cas
 * d'échec — l'appelant (video-render) décide du repli (pas d'incrustation avatar).
 */
export async function synthesizeAvatarClip(imageB64: string, audioB64: string): Promise<Buffer> {
  const url = process.env.MODAL_AVATAR_URL!.trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Modal-Key': process.env.MODAL_KEY!.trim(),
      'Modal-Secret': process.env.MODAL_SECRET!.trim(),
    },
    body: JSON.stringify({ image_b64: imageB64, audio_b64: audioB64 }),
    // 1er appel à froid : téléchargement des poids (~Go) + chargement modèle +
    // inférence. Peut atteindre plusieurs minutes ; on laisse une marge.
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Modal avatar ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
