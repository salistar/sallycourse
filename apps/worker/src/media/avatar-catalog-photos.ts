// Portraits des avatars du catalogue (2026-07-26 — voir
// packages/shared/src/avatar-catalog.ts pour la doctrine).
//
// Chaque avatar du catalogue a un portrait frontal PNG, généré UNE fois par le
// pipeline image du produit (SDXL/Z-Image — licence maîtrisée, aucun asset
// externe) puis mis en cache storage sous avatar-catalog/{id}.png. Ce portrait
// est ensuite animé par Ditto (photo + audio → vidéo présentateur) dans
// video-render. Paresseux et best-effort : sans moteur d'image configuré, on
// retourne null et l'avatar retombe sur le comportement historique (carte
// titre animée / HeyGen selon le plan).
import {
  avatarCatalogPhotoKey,
  getConfig,
  objectExists,
  uploadObject,
  type CatalogAvatar,
} from '../shared.js';
import { generateImageWithEngine, isAnyImageEngineConfigured } from './image-generation.js';
import { logger } from '../queues/index.js';

/** Seed stable par avatar : le portrait de « clara » est le même partout. */
function avatarSeed(avatarId: string): number {
  let hash = 0;
  for (const ch of avatarId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 1_000_000;
}

/**
 * Garantit le portrait d'un avatar du catalogue et retourne sa clé storage —
 * null si aucun moteur d'image n'est disponible ou si la génération échoue
 * (l'appelant garde alors son repli historique).
 */
export async function ensureCatalogAvatarPhoto(avatar: CatalogAvatar): Promise<string | null> {
  if (getConfig().MOCK_PROVIDERS) return null;
  const key = avatarCatalogPhotoKey(avatar.id);
  try {
    if (await objectExists(key)) return key;
    if (!isAnyImageEngineConfigured()) return null;
    const { png, provider } = await generateImageWithEngine({
      prompt: avatar.photoPrompt,
      negativePrompt:
        'cartoon, illustration, painting, low quality, blurry, deformed face, extra fingers, side profile, sunglasses, hat, text, watermark',
      width: 768,
      height: 768,
      seed: avatarSeed(avatar.id),
    });
    await uploadObject(key, png, 'image/png');
    logger.info({ avatarId: avatar.id, provider, bytes: png.length }, 'portrait avatar du catalogue généré et mis en cache');
    return key;
  } catch (err) {
    logger.warn({ avatarId: avatar.id, err }, 'portrait avatar du catalogue indisponible — repli historique');
    return null;
  }
}
