// Génération d'images Z-Image Turbo déployée sur Modal (GPU L4) — ajout
// ADDITIF suite à l'audit qualité modèles du 2026-07-22 (voir
// modal/zimage_turbo.py) : ne remplace PAS SDXL (modal-image-provider.ts),
// les deux coexistent — Course.imageEngine / le bouton « switch » par slide
// choisit lequel est utilisé (media/image-generation.ts).
//
// Contrat de l'endpoint (voir modal/zimage_turbo.py) — IDENTIQUE à SDXL :
//   POST {MODAL_ZIMAGE_URL}  JSON { prompt, negative_prompt?, width?, height?,
//     steps?, seed? }  ->  image/png
// `negative_prompt`/`steps` sont acceptés pour le contrat commun mais ignorés
// côté endpoint (modèle Turbo distillé pour un point de fonctionnement figé).
import { getConfig } from '../shared.js';
import type { ImageGenParams } from './modal-image-provider.js';

/** true si l'endpoint Modal Z-Image Turbo est configuré, activé, et non masqué par le mock. */
export function isZImageConfigured(): boolean {
  const cfg = getConfig();
  if (cfg.MOCK_PROVIDERS) return false;
  const enabled = process.env.MODAL_ZIMAGE?.trim().toLowerCase() === 'true';
  return (
    enabled &&
    Boolean(
      process.env.MODAL_ZIMAGE_URL?.trim() && process.env.MODAL_KEY?.trim() && process.env.MODAL_SECRET?.trim(),
    )
  );
}

/**
 * Génère une image PNG via Z-Image Turbo sur Modal. Retourne le buffer PNG.
 * Jette en cas d'échec — l'appelant (media/image-generation.ts) décide du
 * repli (SDXL).
 */
export async function generateZImage(params: ImageGenParams): Promise<Buffer> {
  const url = process.env.MODAL_ZIMAGE_URL!.trim();
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
    // Cold-start GPU (install source diffusers au premier boot du conteneur,
    // pas par requête) + génération : borne large comme SDXL.
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Modal Z-Image ${res.status} : ${detail.slice(0, 200)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}
