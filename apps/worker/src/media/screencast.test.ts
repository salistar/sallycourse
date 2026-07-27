import { describe, expect, it } from 'vitest';
import {
  buildOverlayFilter,
  buildScreencastNarrationArgs,
  type ScreencastOverlay,
} from './screencast.js';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

describe('buildOverlayFilter', () => {
  const base: ScreencastOverlay = { text: 'Étape 1', startSec: 2, endSec: 6 };
  const TEXTFILE = '/tmp/screencast/overlay-0.txt';

  it('lit le texte via textfile (jamais inline) et pose la fenêtre temporelle', () => {
    const f = buildOverlayFilter(base, FONT, TEXTFILE);
    expect(f).toContain('drawtext=');
    // Le texte auteur ne doit PAS apparaître dans la chaîne de filtres (anti-injection).
    expect(f).not.toContain("text='Étape 1'");
    expect(f).not.toContain('Étape 1');
    expect(f).toContain(`textfile='${TEXTFILE}'`);
    expect(f).toContain("enable='between(t,2.00,6.00)'");
    expect(f).toContain('box=1');
  });

  it('n’injecte rien même si le texte contient des métacaractères ffmpeg', () => {
    // Le texte dangereux vit dans le FICHIER, pas dans les args : la chaîne de
    // filtres ne contient que le chemin du textfile, donc aucune injection.
    const evil: ScreencastOverlay = { text: "x',drawtext=text=pwned:x=0[a];[a]", startSec: 0, endSec: 1 };
    const f = buildOverlayFilter(evil, FONT, TEXTFILE);
    expect(f).not.toContain('pwned');
    expect(f).toContain(`textfile='${TEXTFILE}'`);
  });

  it('clamp endSec >= startSec et startSec >= 0', () => {
    const f = buildOverlayFilter({ text: 'x', startSec: -3, endSec: -1 }, FONT, TEXTFILE);
    expect(f).toContain("enable='between(t,0.00,0.00)'");
  });

  it('positionne en haut / centre / bas', () => {
    expect(buildOverlayFilter({ ...base, position: 'top' }, FONT, TEXTFILE)).toContain('y=h*0.08');
    expect(buildOverlayFilter({ ...base, position: 'center' }, FONT, TEXTFILE)).toContain('y=(h-text_h)/2');
    expect(buildOverlayFilter({ ...base, position: 'bottom' }, FONT, TEXTFILE)).toContain('y=h*0.88-text_h');
  });
});

describe('buildScreencastNarrationArgs', () => {
  const overlays: ScreencastOverlay[] = [
    { text: 'Ouvrez le terminal', startSec: 0, endSec: 4 },
    { text: 'Lancez la commande', startSec: 4, endSec: 9, position: 'top' },
  ];
  const textFiles = ['/tmp/s/overlay-0.txt', '/tmp/s/overlay-1.txt'];

  it('mappe la vidéo du 1er input et l’audio du 2e (narration remplace le son)', () => {
    const args = buildScreencastNarrationArgs('rec.mp4', 'narration.m4a', overlays, textFiles, 'out.mp4', FONT);
    expect(args).toContain('rec.mp4');
    expect(args).toContain('narration.m4a');
    const mapIdx = args.indexOf('-map');
    expect(args[mapIdx + 1]).toBe('0:v:0');
    expect(args.slice(mapIdx)).toContain('1:a:0');
  });

  it('inclut un drawtext par overlay (via textfile) dans le filtre vidéo', () => {
    const args = buildScreencastNarrationArgs('rec.mp4', 'a.m4a', overlays, textFiles, 'out.mp4', FONT);
    const vfIdx = args.indexOf('-vf');
    const vf = args[vfIdx + 1]!;
    expect(vf.startsWith('format=yuv420p')).toBe(true);
    expect(vf.match(/drawtext=/g)).toHaveLength(2);
    expect(vf).toContain(textFiles[0]);
    expect(vf).toContain(textFiles[1]);
  });

  it('complète la narration par du silence (apad) et cale la durée sur la vidéo', () => {
    const args = buildScreencastNarrationArgs('rec.mp4', 'a.m4a', [], [], 'out.mp4', FONT);
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args).toContain('+faststart');
    // apad + -shortest : la vidéo (finie) devient l'ancre de durée.
    expect(args[args.indexOf('-af') + 1]).toBe('apad');
    expect(args).toContain('-shortest');
    expect(args[args.length - 1]).toBe('out.mp4');
  });
});
