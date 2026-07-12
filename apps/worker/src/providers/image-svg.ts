// Prompt 151 — wrapper ImageProvider autour de
// @sallycourse/design/marketing-assets::generateCourseImage (SVG procédural
// déterministe, P11/D11). OSS par défaut : zéro dépendance externe, zéro coût,
// toujours disponible (aucun service à démarrer) — c'est le comportement PAR
// DÉFAUT du pipeline tant qu'aucun provider cloud/GPU (ComfyUI, P154) n'est
// sélectionné par registry.ts.
import { generateCourseImage } from '../shared.js';
import type { ImageProvider, ImageProviderCallOptions } from './types.js';

export const svgImageProvider: ImageProvider = {
  name: 'svg',
  async generate(prompt: string, opts: ImageProviderCallOptions = {}): Promise<Buffer> {
    const svg = generateCourseImage({
      title: prompt,
      format: opts.format ?? 'og',
      lang: opts.lang ?? 'fr',
      seed: opts.seed,
    });
    return Buffer.from(svg, 'utf-8');
  },
};
