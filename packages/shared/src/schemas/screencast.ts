import { z } from 'zod';

/**
 * Schéma PARTAGÉ de l'entrée « capture d'écran narrée » (Feature B).
 *
 * Source de vérité unique alignée EXACTEMENT sur l'interface `ScreencastOverlay`
 * du primitif worker (apps/worker/src/media/screencast.ts) : la route API valide
 * l'upload avec ce schéma, le worker type les overlays lus depuis le stockage,
 * et l'éditeur de légendes chronométrées côté UI en dérive ses types. Aucune
 * duplication de forme entre les trois couches.
 *
 * L'auteur uploade un enregistrement d'écran (MP4), saisit un `narrationText`
 * (synthétisé avec la voix du cours) et une liste de légendes horodatées à
 * incruster (drawtext). Ce module ne fait QUE valider/typer — aucune I/O.
 */

/** Ancrages verticaux d'une légende (miroir de ScreencastOverlay['position']). */
export const SCREENCAST_OVERLAY_POSITIONS = ['bottom', 'top', 'center'] as const;
export type ScreencastOverlayPosition = (typeof SCREENCAST_OVERLAY_POSITIONS)[number];

/** Longueur max d'une légende (une à deux lignes courtes incrustées). */
export const MAX_SCREENCAST_OVERLAY_TEXT = 200;
/** Borne raisonnable du nombre de légendes par capture (évite un filtre ffmpeg démesuré). */
export const MAX_SCREENCAST_OVERLAYS = 100;
/** Longueur max du texte de narration à synthétiser (garde-fou coût TTS). */
export const MAX_SCREENCAST_NARRATION = 20_000;

/**
 * Une légende horodatée. Bornes : `startSec >= 0`, `endSec > startSec` (fenêtre
 * d'affichage non vide), `position` par défaut `bottom`. Les CHEVAUCHEMENTS entre
 * légendes sont TOLÉRÉS : drawtext superpose plusieurs incrustations simultanées
 * (l'auteur peut vouloir deux légendes visibles en même temps, ex. haut + bas) —
 * on ne rejette donc pas les intervalles qui se recouvrent.
 */
export const screencastOverlaySchema = z
  .object({
    text: z.string().trim().min(1, 'Légende vide').max(MAX_SCREENCAST_OVERLAY_TEXT),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    // `.default('bottom')` : l'entrée peut omettre la position (comme l'interface
    // worker où elle est optionnelle) ; la sortie validée la porte toujours.
    position: z.enum(SCREENCAST_OVERLAY_POSITIONS).default('bottom'),
  })
  .refine((o) => o.endSec > o.startSec, {
    message: 'La fin doit être strictement postérieure au début.',
    path: ['endSec'],
  });

/** Overlay d'entrée (position optionnelle). */
export type ScreencastOverlayInput = z.input<typeof screencastOverlaySchema>;
/** Overlay validé (position toujours renseignée) — compatible ScreencastOverlay du worker. */
export type ScreencastOverlay = z.infer<typeof screencastOverlaySchema>;

/** Liste de légendes bornée. */
export const screencastOverlaysSchema = z
  .array(screencastOverlaySchema)
  .max(MAX_SCREENCAST_OVERLAYS, `Trop de légendes (max ${MAX_SCREENCAST_OVERLAYS}).`);

/**
 * Entrée complète d'un rendu : narration (obligatoire, synthétisée avec la voix
 * du cours) + légendes (liste éventuellement vide). Persistée telle quelle dans
 * le stockage (JSON) puis relue par le worker de rendu.
 */
export const screencastRenderInputSchema = z.object({
  narrationText: z.string().trim().min(1, 'Narration vide').max(MAX_SCREENCAST_NARRATION),
  overlays: screencastOverlaysSchema.default([]),
});

export type ScreencastRenderInput = z.infer<typeof screencastRenderInputSchema>;
