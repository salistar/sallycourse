import { describe, expect, it } from 'vitest';
import {
  MAX_SCREENCAST_OVERLAYS,
  MAX_SCREENCAST_OVERLAY_TEXT,
  screencastOverlaySchema,
  screencastOverlaysSchema,
  screencastRenderInputSchema,
} from './screencast';

describe('screencastOverlaySchema', () => {
  const base = { text: 'Ouvrez le terminal', startSec: 0, endSec: 4 };

  it('accepte une légende valide et applique la position par défaut « bottom »', () => {
    const parsed = screencastOverlaySchema.parse(base);
    expect(parsed.position).toBe('bottom');
    expect(parsed.text).toBe('Ouvrez le terminal');
  });

  it('conserve une position explicite', () => {
    expect(screencastOverlaySchema.parse({ ...base, position: 'top' }).position).toBe('top');
    expect(screencastOverlaySchema.parse({ ...base, position: 'center' }).position).toBe('center');
  });

  it('rejette une position inconnue', () => {
    expect(screencastOverlaySchema.safeParse({ ...base, position: 'left' }).success).toBe(false);
  });

  it('rejette endSec <= startSec (fenêtre vide ou inversée)', () => {
    expect(screencastOverlaySchema.safeParse({ text: 'x', startSec: 4, endSec: 4 }).success).toBe(false);
    expect(screencastOverlaySchema.safeParse({ text: 'x', startSec: 5, endSec: 2 }).success).toBe(false);
  });

  it('rejette startSec négatif', () => {
    expect(screencastOverlaySchema.safeParse({ text: 'x', startSec: -1, endSec: 2 }).success).toBe(false);
  });

  it('rejette startSec / endSec non finis', () => {
    expect(
      screencastOverlaySchema.safeParse({ text: 'x', startSec: Number.NaN, endSec: 2 }).success,
    ).toBe(false);
    expect(
      screencastOverlaySchema.safeParse({ text: 'x', startSec: 0, endSec: Number.POSITIVE_INFINITY })
        .success,
    ).toBe(false);
  });

  it('trim le texte et rejette une légende vide', () => {
    expect(screencastOverlaySchema.parse({ ...base, text: '  npm test  ' }).text).toBe('npm test');
    expect(screencastOverlaySchema.safeParse({ ...base, text: '   ' }).success).toBe(false);
  });

  it('rejette un texte trop long', () => {
    const tooLong = 'a'.repeat(MAX_SCREENCAST_OVERLAY_TEXT + 1);
    expect(screencastOverlaySchema.safeParse({ ...base, text: tooLong }).success).toBe(false);
  });

  it('tolère les chevauchements entre légendes (aucune contrainte inter-overlay)', () => {
    const overlapping = [
      { text: 'A', startSec: 0, endSec: 5, position: 'top' as const },
      { text: 'B', startSec: 2, endSec: 8, position: 'bottom' as const },
    ];
    expect(screencastOverlaysSchema.safeParse(overlapping).success).toBe(true);
  });
});

describe('screencastOverlaysSchema', () => {
  it('accepte une liste vide', () => {
    expect(screencastOverlaysSchema.parse([])).toEqual([]);
  });

  it('rejette au-delà de la borne max', () => {
    const many = Array.from({ length: MAX_SCREENCAST_OVERLAYS + 1 }, (_, i) => ({
      text: `c${i}`,
      startSec: i,
      endSec: i + 1,
    }));
    expect(screencastOverlaysSchema.safeParse(many).success).toBe(false);
  });
});

describe('screencastRenderInputSchema', () => {
  it('valide narration + overlays et défaut overlays=[]', () => {
    const parsed = screencastRenderInputSchema.parse({ narrationText: 'Bonjour' });
    expect(parsed.overlays).toEqual([]);
    expect(parsed.narrationText).toBe('Bonjour');
  });

  it('rejette une narration vide', () => {
    expect(screencastRenderInputSchema.safeParse({ narrationText: '   ' }).success).toBe(false);
    expect(screencastRenderInputSchema.safeParse({ narrationText: '' }).success).toBe(false);
  });

  it('propage l’échec de validation d’un overlay', () => {
    const bad = { narrationText: 'ok', overlays: [{ text: 'x', startSec: 3, endSec: 1 }] };
    expect(screencastRenderInputSchema.safeParse(bad).success).toBe(false);
  });
});
