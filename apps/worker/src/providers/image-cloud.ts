// Prompt 151 — ImageProvider « cloud » : placeholder documenté.
//
// Aucun provider d'image cloud payant (Stability AI, DALL·E, Midjourney API…)
// n'est câblé pour l'instant dans SallyCourse — la génération d'image existante
// est 100% OSS (SVG procédural, image-svg.ts) ou GPU auto-hébergé (ComfyUI,
// providers/comfyui-provider.ts, Prompt 154). Ce module existe pour que le
// registre (registry.ts) ait un candidat 'cloud' cohérent avec les autres
// familles (llm/tts/email) SANS bloquer le pipeline : tant qu'aucune clé n'est
// configurée, il retombe silencieusement sur le générateur SVG (comportement
// mock-friendly identique aux autres providers du fichier).
//
// Pour brancher un vrai provider cloud plus tard : ajouter la clé optionnelle
// correspondante dans packages/shared/src/config.ts (ex. STABILITY_API_KEY),
// puis remplacer le corps de `generate` ci-dessous par l'appel HTTP réel,
// toujours avec le même repli SVG en cas d'échec/absence de clé.
import { logger } from '../queues/index.js';
import { svgImageProvider } from './image-svg.js';
import type { ImageProvider, ImageProviderCallOptions } from './types.js';

export const cloudImageProvider: ImageProvider = {
  name: 'cloud',
  async generate(prompt: string, opts: ImageProviderCallOptions = {}): Promise<Buffer> {
    logger.debug('image-cloud : aucun provider cloud câblé — repli SVG procédural (image-svg.ts)');
    return svgImageProvider.generate(prompt, opts);
  },
};
