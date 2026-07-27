import { describe, expect, it } from 'vitest';
import { buildShotArgs, pickShotKeys, planTrailerShots } from './trailer.js';

describe('pickShotKeys (P197)', () => {
  it('garde toutes les slides si peu nombreuses', () => {
    const keys = ['a', 'b', 'c'];
    expect(pickShotKeys(keys, 8)).toEqual(keys);
  });

  it('échantillonne sur TOUT le cours (début, milieu, fin) si trop de slides', () => {
    const keys = Array.from({ length: 40 }, (_, i) => `slide-${i}`);
    const picked = pickShotKeys(keys, 8);
    expect(picked).toHaveLength(8);
    expect(picked[0]).toBe('slide-0'); // début
    expect(picked[7]).toBe('slide-35'); // fin (réparti, pas les 8 premiers)
    expect(new Set(picked).size).toBe(8); // pas de doublon
  });
});

describe('planTrailerShots (P197) — le montage dure exactement la narration', () => {
  const keys = Array.from({ length: 40 }, (_, i) => `slide-${i}`);

  it('cas nominal : 8 plans répartis sur une narration de 72 s', () => {
    const { shots, perShot } = planTrailerShots(keys, 72);
    expect(shots).toHaveLength(8);
    expect(perShot).toBe(9);
    expect(shots.length * perShot).toBe(72);
  });

  it('narration COURTE : réduit le nombre de plans au lieu de dépasser la narration', () => {
    // 10 s : 8 plans donneraient 1,25 s/plan → le plancher (2 s) les rallongerait
    // à 16 s de vidéo pour 10 s d'audio, et `-shortest` couperait la fin.
    const { shots, perShot } = planTrailerShots(keys, 10);
    expect(shots).toHaveLength(5);
    expect(perShot).toBe(2);
    expect(shots.length * perShot).toBe(10); // montage == narration, rien n'est coupé
  });

  it('aucun plan ne descend jamais sous le plancher de 2 s, quelle que soit la narration', () => {
    for (const sec of [10, 11, 15, 23, 37, 60, 72, 90, 120]) {
      const { shots, perShot } = planTrailerShots(keys, sec);
      expect(perShot).toBeGreaterThanOrEqual(2);
      expect(shots.length * perShot).toBeCloseTo(sec, 6); // invariant : durée exacte
    }
  });

  it('ne fabrique pas plus de plans qu’il n’y a de slides', () => {
    const { shots, perShot } = planTrailerShots(['a', 'b'], 90);
    expect(shots).toHaveLength(2);
    expect(shots.length * perShot).toBe(90);
  });
});

describe('buildShotArgs (P197)', () => {
  it('tient l’image la durée demandée, avec fondus in/out', () => {
    const args = buildShotArgs('img.png', 'out.mp4', 6);
    expect(args).toContain('-loop');
    expect(args[args.indexOf('-t') + 1]).toBe('6.000');
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain('fade=t=in:st=0:d=0.4');
    expect(vf).toContain('fade=t=out:st=5.60');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('applique une durée plancher (pas de plan épileptique)', () => {
    const args = buildShotArgs('img.png', 'out.mp4', 0.5);
    expect(args[args.indexOf('-t') + 1]).toBe('2.000');
  });
});
