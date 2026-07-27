// Génération d'images (SDXL) déployée sur Modal (GPU L4) — cover art de cours,
// illustrations de leçons, hero du blog SEO, visuels de bande-annonce. Endpoint
// proxy-auth Modal (headers Modal-Key / Modal-Secret, mêmes tokens que
// Chatterbox/Ditto/Whisper). Payant à l'usage (GPU) : activé via MODAL_IMAGE.
//
// Contrat de l'endpoint (voir modal/image_gen.py) :
//   POST {MODAL_IMAGE_URL}  JSON { prompt, negative_prompt?, width?, height?,
//     steps?, seed? }  ->  image/png
import { getConfig } from '../shared.js';

export interface ImageGenParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  /** Seed → reproductibilité (même cours = même cover). */
  seed?: number;
}

/** true si l'endpoint Modal image est configuré, activé, et non masqué par le mock. */
export function isModalImageConfigured(): boolean {
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDERS) return false;
  const enabled = process.env.MODAL_IMAGE?.trim().toLowerCase() === 'true';
  return (
    enabled &&
    Boolean(
      process.env.MODAL_IMAGE_URL?.trim() &&
        process.env.MODAL_KEY?.trim() &&
        process.env.MODAL_SECRET?.trim(),
    )
  );
}

/**
 * Génère une image PNG via SDXL sur Modal. Retourne le buffer PNG. Jette en cas
 * d'échec — l'appelant décide du repli (ex. garder la miniature SVG générée).
 */
export async function generateModalImage(params: ImageGenParams): Promise<Buffer> {
  const url = process.env.MODAL_IMAGE_URL!.trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Modal-Key': process.env.MODAL_KEY!.trim(),
      'Modal-Secret': process.env.MODAL_SECRET!.trim(),
    },
    body: JSON.stringify({
      prompt: params.prompt,
      ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
      ...(params.width ? { width: params.width } : {}),
      ...(params.height ? { height: params.height } : {}),
      ...(params.steps ? { steps: params.steps } : {}),
      ...(params.seed !== undefined ? { seed: params.seed } : {}),
    }),
    // Cold-start GPU + diffusion : peut atteindre ~2 min à froid.
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Modal Image ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
