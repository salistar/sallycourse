// Dispatch entre les moteurs d'image premium (audit qualité modèles
// 2026-07-22, additif) : SDXL (défaut historique, media/modal-image-provider)
// et Z-Image Turbo (nouveau, providers/zimage-provider). Point d'entrée UNIQUE
// pour tout call-site qui générait jusqu'ici via `generateModalImage`
// directement — comportement par défaut (engine absent/'sdxl') STRICTEMENT
// inchangé.
import sharp from 'sharp';
import { logger } from '../queues/index.js';
import { generateModalImage, isModalImageConfigured, type ImageGenParams } from '../providers/modal-image-provider.js';
import { generateZImage, isZImageConfigured } from '../providers/zimage-provider.js';

export type ImageEngine = 'sdxl' | 'zimage';

export interface GeneratedImage {
  png: Buffer;
  /** Moteur ayant effectivement produit l'image (peut différer de celui demandé en cas de repli). */
  provider: ImageEngine;
  /**
   * Résultat de la vérification de l'image renvoyée (2026-07-26). `ok:false`
   * signale une image suspecte même après repli SDXL : l'appelant peut alors
   * choisir de NE PAS l'intégrer (garder le motif géométrique par défaut).
   */
  validation: ImageValidation;
}

/** Résultat d'une vérification d'image générée. */
export interface ImageValidation {
  ok: boolean;
  /** Raison de rejet (undefined si ok) — pour le log. */
  reason?: string;
  /** Métadonnées mesurées, exploitables par l'appelant. */
  width?: number;
  height?: number;
  bytes?: number;
}

// Seuils de validation (vérification des images AVANT intégration, demande
// produit 2026-07-26). Une image ratée d'un GPU se manifeste presque toujours
// par : un buffer minuscule (erreur encodée), des dimensions aberrantes, ou une
// image quasi-unie (bruit d'échec / dégénérée). On les rejette pour ne jamais
// intégrer une illustration cassée dans une vidéo/cover.
const MIN_BYTES = 3 * 1024; // < 3 Ko : quasi certainement une image vide/corrompue.
const MIN_DIMENSION = 64; // px : en-dessous, ce n'est pas une illustration exploitable.
const MIN_STDDEV = 3.5; // écart-type des canaux : ~0 = image unie (échec de génération).

/**
 * Vérifie qu'une image générée est réellement exploitable AVANT de l'intégrer
 * (2026-07-26). Contrôles : buffer non vide et au-dessus d'un plancher, image
 * décodable par sharp, dimensions plausibles (≈ celles demandées si fournies),
 * et contenu non quasi-uni (une image toute noire/blanche trahit un échec du
 * modèle). Best-effort : si sharp échoue à lire le buffer, c'est un rejet.
 */
export async function validateGeneratedImage(
  png: Buffer,
  expected?: { width?: number; height?: number },
): Promise<ImageValidation> {
  const bytes = png?.length ?? 0;
  if (bytes < MIN_BYTES) {
    return { ok: false, reason: `image trop légère (${bytes} o < ${MIN_BYTES} o)`, bytes };
  }

  let meta: sharp.Metadata;
  let stats: sharp.Stats;
  try {
    const img = sharp(png, { failOn: 'error' });
    meta = await img.metadata();
    stats = await img.stats();
  } catch (err) {
    return { ok: false, reason: `image indécodable (${err instanceof Error ? err.message : 'inconnue'})`, bytes };
  }

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return { ok: false, reason: `dimensions aberrantes (${width}×${height})`, width, height, bytes };
  }

  // Écart de dimension trop grand vs. attendu (le modèle a renvoyé autre chose).
  if (expected?.width && expected?.height) {
    const ratioW = width / expected.width;
    const ratioH = height / expected.height;
    if (ratioW < 0.5 || ratioW > 2 || ratioH < 0.5 || ratioH > 2) {
      return { ok: false, reason: `dimensions ${width}×${height} loin de ${expected.width}×${expected.height}`, width, height, bytes };
    }
  }

  // Image quasi-unie : le max des écarts-types par canal est proche de 0 →
  // aucune structure → échec de génération (noir/blanc/aplat).
  const maxStdev = Math.max(...stats.channels.map((c) => c.stdev));
  if (maxStdev < MIN_STDDEV) {
    return { ok: false, reason: `image quasi-unie (σ=${maxStdev.toFixed(2)})`, width, height, bytes };
  }

  return { ok: true, width, height, bytes };
}

/**
 * Génère une image en respectant le moteur préféré (`engine`), avec repli
 * gracieux vers SDXL si le moteur demandé n'est pas configuré ou échoue —
 * jamais d'échec de génération pour une simple préférence de moteur. Absent/
 * 'sdxl' : appelle directement SDXL, comportement IDENTIQUE à avant cet ajout.
 *
 * VÉRIFICATION AVANT INTÉGRATION (2026-07-26) : chaque sortie moteur passe par
 * `validateGeneratedImage`. Une image invalide (vide, corrompue, dégénérée) est
 * traitée comme un échec moteur → repli vers SDXL. Si même SDXL rend une image
 * invalide, on la renvoie tout de même (avec un log d'alerte) : le call-site
 * best-effort décidera (garder le motif géométrique par défaut), mais on ne
 * bloque jamais le pipeline sur ce point.
 */
export async function generateImageWithEngine(params: ImageGenParams, engine?: ImageEngine): Promise<GeneratedImage> {
  const expected = { width: params.width, height: params.height };

  if (engine === 'zimage' && isZImageConfigured()) {
    try {
      const png = await generateZImage(params);
      const check = await validateGeneratedImage(png, expected);
      if (check.ok) return { png, provider: 'zimage', validation: check };
      logger.warn({ reason: check.reason }, 'Z-Image Turbo : image rejetée à la vérification — repli vers SDXL');
    } catch (err) {
      logger.warn({ err }, 'Z-Image Turbo indisponible — repli vers SDXL');
    }
  }

  const png = await generateModalImage(params);
  const check = await validateGeneratedImage(png, expected);
  if (!check.ok) {
    logger.warn({ reason: check.reason }, 'SDXL : image suspecte à la vérification (intégration best-effort côté appelant)');
  }
  return { png, provider: 'sdxl', validation: check };
}

/** true si AU MOINS UN moteur d'image est exploitable (pour les gardes best-effort existantes). */
export function isAnyImageEngineConfigured(): boolean {
  return isModalImageConfigured() || isZImageConfigured();
}
