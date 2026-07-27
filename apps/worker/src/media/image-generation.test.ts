import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { validateGeneratedImage } from './image-generation.js';

/**
 * Vérification des images AVANT intégration (2026-07-26) — validateGeneratedImage.
 * On fabrique de vraies images PNG via sharp pour couvrir les cas réels :
 * image structurée (OK), image quasi-unie (échec de génération), buffer trop
 * petit, buffer indécodable, dimensions aberrantes.
 */

/** PNG bruité (haute entropie, non-périodique → PNG non compressible) aux
 *  dimensions données. Hash par pixel : évite qu'un motif périodique compresse
 *  sous le plancher MIN_BYTES (ce qui masquerait le vrai comportement). */
async function noisyPng(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) {
    // Hash entier type xorshift → octet quasi-aléatoire, déterministe.
    let h = Math.imul(i + 0x9e3779b1, 2654435761) >>> 0;
    h ^= h >>> 15;
    pixels[i] = (h >>> 8) & 0xff;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** PNG uni (une seule couleur) — trahit un échec de génération. */
async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 12, g: 7, b: 20 } } })
    .png()
    .toBuffer();
}

describe('validateGeneratedImage', () => {
  it('accepte une image structurée aux bonnes dimensions', async () => {
    const png = await noisyPng(896, 896);
    const res = await validateGeneratedImage(png, { width: 896, height: 896 });
    expect(res.ok).toBe(true);
    expect(res.width).toBe(896);
  });

  it('rejette une image quasi-unie (σ ≈ 0)', async () => {
    const png = await solidPng(896, 896);
    const res = await validateGeneratedImage(png, { width: 896, height: 896 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/uni/);
  });

  it('rejette un buffer trop petit', async () => {
    const res = await validateGeneratedImage(Buffer.from([1, 2, 3, 4]));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/légère|léger/i);
  });

  it('rejette un buffer indécodable (pas une image)', async () => {
    const junk = Buffer.alloc(8 * 1024, 0x42); // gros mais pas un PNG
    const res = await validateGeneratedImage(junk);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/indécodable|légère/i);
  });

  it('rejette des dimensions trop éloignées de celles attendues', async () => {
    const png = await noisyPng(128, 128);
    const res = await validateGeneratedImage(png, { width: 896, height: 896 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/dimensions/);
  });

  it('accepte sans dimensions attendues si l’image est structurée et assez grande', async () => {
    const png = await noisyPng(256, 256);
    const res = await validateGeneratedImage(png);
    expect(res.ok).toBe(true);
  });
});
