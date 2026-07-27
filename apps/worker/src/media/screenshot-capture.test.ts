// Tests unitaires du cœur de capture : garde SSRF (assertUrlAllowed/isBlockedIp)
// et lecture d'en-tête PNG. Aucune dépendance réseau ni navigateur réel.
import { describe, expect, it } from 'vitest';
import type { Page, Response as PlaywrightResponse } from 'playwright';
import {
  ScreenshotCaptureError,
  assertUrlAllowed,
  assessPageContent,
  buildScreencastPostProcessArgs,
  buildZoompanFilter,
  hashScreenshotSpec,
  isBlockedIp,
  isScreencastSpec,
  readPngSize,
} from './screenshot-capture.js';
import type { TpScreenshotSpec } from '../shared.js';

/** Double minimal de Page — seuls title()/evaluate() sont consultés par assessPageContent. */
function fakePage(title: string, bodyText: string): Page {
  return {
    title: async () => title,
    evaluate: async () => bodyText,
  } as unknown as Page;
}

function fakeResponse(status: number): PlaywrightResponse {
  return { status: () => status } as unknown as PlaywrightResponse;
}

describe('isBlockedIp', () => {
  it('bloque les IPv4 privées, loopback, lien-local et métadonnées', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('autorise les IPv4 publiques', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it('bloque loopback et unique-local IPv6, y compris IPv4 mappée privée', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('refuse une chaîne non-IP', () => {
    expect(isBlockedIp('pas-une-ip')).toBe(true);
  });
});

describe('assertUrlAllowed', () => {
  it('refuse localhost et les sous-domaines .localhost sans résoudre', async () => {
    await expect(assertUrlAllowed('http://localhost:3000/demo')).rejects.toBeInstanceOf(ScreenshotCaptureError);
    await expect(assertUrlAllowed('http://app.localhost/')).rejects.toBeInstanceOf(ScreenshotCaptureError);
  });

  it('refuse une IP littérale privée', async () => {
    await expect(assertUrlAllowed('http://127.0.0.1:8080/')).rejects.toThrow(/privée|réservée/i);
    await expect(assertUrlAllowed('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      ScreenshotCaptureError,
    );
  });

  it('refuse les schémas non http/https', async () => {
    await expect(assertUrlAllowed('file:///etc/passwd')).rejects.toThrow(/schéma/);
    await expect(assertUrlAllowed('ftp://example.com/')).rejects.toThrow(/schéma/);
  });

  it('accepte une IP publique littérale', async () => {
    await expect(assertUrlAllowed('https://8.8.8.8/')).resolves.toBeUndefined();
  });

  it('court-circuite la garde pour une URL de loopback de confiance', async () => {
    const trusted = new Set(['http://127.0.0.1:3000/']);
    await expect(assertUrlAllowed('http://127.0.0.1:3000/', trusted)).resolves.toBeUndefined();
  });
});

describe('assessPageContent (correctif N2, audit 2026-07-20)', () => {
  it('accepte une page saine (statut 200, contenu normal)', async () => {
    const result = await assessPageContent(fakePage('MetalloGreen — audit', 'Bienvenue sur le portail.'), fakeResponse(200));
    expect(result.suspicious).toBe(false);
  });

  it('rejette une réponse HTTP en erreur (404)', async () => {
    const result = await assessPageContent(fakePage('Page not found', ''), fakeResponse(404));
    expect(result.suspicious).toBe(true);
    expect(result.reason).toMatch(/404/);
  });

  it('rejette une page 404 même sans objet Response (ex. après un clic, pas une navigation directe)', async () => {
    const result = await assessPageContent(fakePage('404 - Page non trouvée', 'Erreur'), null);
    expect(result.suspicious).toBe(true);
  });

  it("rejette l'état par défaut connu d'un éditeur tiers (StackEdit, Mermaid Live)", async () => {
    const stackedit = await assessPageContent(fakePage('StackEdit', 'Welcome to StackEdit!'), fakeResponse(200));
    expect(stackedit.suspicious).toBe(true);

    const mermaid = await assessPageContent(fakePage('Mermaid Live Editor', ''), fakeResponse(200));
    expect(mermaid.suspicious).toBe(true);
  });

  it("n'échoue jamais si title()/evaluate() jettent (best-effort)", async () => {
    const page = {
      title: async () => {
        throw new Error('page fermée');
      },
      evaluate: async () => {
        throw new Error('page fermée');
      },
    } as unknown as Page;
    const result = await assessPageContent(page, fakeResponse(200));
    expect(result.suspicious).toBe(false);
  });
});

describe('readPngSize', () => {
  it('lit les dimensions depuis l’IHDR', () => {
    // En-tête PNG minimal : signature + longueur+"IHDR" + width/height.
    const header = Buffer.alloc(24);
    header.write('89504e470d0a1a0a', 0, 'hex');
    header.writeUInt32BE(1920, 16);
    header.writeUInt32BE(1080, 20);
    expect(readPngSize(header)).toEqual({ width: 1920, height: 1080 });
  });

  it('jette si la signature PNG est absente', () => {
    expect(() => readPngSize(Buffer.alloc(24))).toThrow(ScreenshotCaptureError);
  });
});

describe('hashScreenshotSpec', () => {
  const baseSpec: TpScreenshotSpec = {
    url: 'https://example.com/demo',
    actions: [{ type: 'click', selector: '#start' }],
    caption: 'Écran de démarrage',
  };

  it('est déterministe : la même spec produit le même hash', () => {
    expect(hashScreenshotSpec(baseSpec)).toBe(hashScreenshotSpec({ ...baseSpec }));
  });

  it('change si la légende change (composée DANS l’image annotée)', () => {
    expect(hashScreenshotSpec(baseSpec)).not.toBe(hashScreenshotSpec({ ...baseSpec, caption: 'Autre légende' }));
  });

  it('change si les actions changent', () => {
    const other: TpScreenshotSpec = {
      ...baseSpec,
      actions: [{ type: 'click', selector: '#autre' }],
    };
    expect(hashScreenshotSpec(baseSpec)).not.toBe(hashScreenshotSpec(other));
  });

  it('change si focusSelector change', () => {
    expect(hashScreenshotSpec(baseSpec)).not.toBe(
      hashScreenshotSpec({ ...baseSpec, focusSelector: '#panel' }),
    );
  });

  it('est indépendant du cours/de la leçon (deux specs identiques dans des contextes différents partagent le hash)', () => {
    // hashScreenshotSpec ne prend QUE la spec : deux TP dans des cours
    // différents avec la même spec produisent la même clé de cache.
    const specCopy: TpScreenshotSpec = JSON.parse(JSON.stringify(baseSpec));
    expect(hashScreenshotSpec(baseSpec)).toBe(hashScreenshotSpec(specCopy));
  });
});

// ── Prompt 85 : mode screencast ─────────────────────────────────────

describe('isScreencastSpec', () => {
  it('détecte le mode screencast quand recordVideo est vrai', () => {
    const spec: TpScreenshotSpec = {
      url: 'https://example.com/demo',
      actions: [],
      caption: 'Démo',
      recordVideo: true,
    };
    expect(isScreencastSpec(spec)).toBe(true);
  });

  it('reste en mode capture simple par défaut (absence de recordVideo, comportement historique)', () => {
    const spec: TpScreenshotSpec = {
      url: 'https://example.com/demo',
      actions: [],
      caption: 'Démo',
    };
    expect(isScreencastSpec(spec)).toBe(false);
  });

  it('reste en mode capture simple si recordVideo est explicitement faux', () => {
    const spec: TpScreenshotSpec = {
      url: 'https://example.com/demo',
      actions: [],
      caption: 'Démo',
      recordVideo: false,
    };
    expect(isScreencastSpec(spec)).toBe(false);
  });
});

describe('buildZoompanFilter', () => {
  it('retourne null sans focusRect (rien à zoomer)', () => {
    expect(
      buildZoompanFilter({ sourceWidth: 1920, sourceHeight: 1080, totalFrames: 90, fps: 30 }),
    ).toBeNull();
  });

  it('retourne null si les dimensions ou le nombre de frames sont invalides', () => {
    const focusRect = { x: 100, y: 100, width: 200, height: 100 };
    expect(buildZoompanFilter({ sourceWidth: 0, sourceHeight: 1080, focusRect, totalFrames: 90, fps: 30 })).toBeNull();
    expect(buildZoompanFilter({ sourceWidth: 1920, sourceHeight: 1080, focusRect, totalFrames: 0, fps: 30 })).toBeNull();
  });

  it('construit une expression zoompan valide centrée sur le focusRect', () => {
    const filter = buildZoompanFilter({
      sourceWidth: 1920,
      sourceHeight: 1080,
      focusRect: { x: 800, y: 400, width: 200, height: 100 },
      totalFrames: 90,
      fps: 30,
    });
    expect(filter).not.toBeNull();
    expect(filter).toMatch(/^zoompan=/);
    expect(filter).toContain('s=1920x1080');
    expect(filter).toContain('fps=30');
    expect(filter).toContain('d=1');
    // Le facteur de zoom par défaut (1.6) doit apparaître dans l'expression z.
    expect(filter).toContain('1.600');
  });

  it('applique le zoomFactor personnalisé', () => {
    const filter = buildZoompanFilter({
      sourceWidth: 1920,
      sourceHeight: 1080,
      focusRect: { x: 800, y: 400, width: 200, height: 100 },
      totalFrames: 90,
      fps: 30,
      zoomFactor: 2,
    });
    expect(filter).toContain('2.000');
  });
});

describe('buildScreencastPostProcessArgs', () => {
  const base = {
    inputVideo: '/tmp/raw.webm',
    output: '/tmp/out.mp4',
    sourceWidth: 1920,
    sourceHeight: 1080,
    durationSeconds: 5,
  };

  it('sans narration : piste audio désactivée (-an), une seule entrée', () => {
    const args = buildScreencastPostProcessArgs(base);
    expect(args).toContain('-an');
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });

  it('avec narration : mixe audio AAC, mappe vidéo+audio, cale sur le plus court', () => {
    const args = buildScreencastPostProcessArgs({ ...base, narrationAudio: '/tmp/narration.mp3' });
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(args).toContain('-shortest');
    expect(args).toContain('aac');
    expect(args).toContain('-map');
    expect(args).not.toContain('-an');
  });

  it('sans focusRect : filtre vidéo de repli (scale+fps), pas de zoompan', () => {
    const args = buildScreencastPostProcessArgs(base);
    const vfIndex = args.indexOf('-vf');
    expect(vfIndex).toBeGreaterThanOrEqual(0);
    expect(args[vfIndex + 1]).toContain('scale=1920:1080');
    expect(args[vfIndex + 1]).not.toContain('zoompan');
  });

  it('avec focusRect : filtre vidéo = zoompan', () => {
    const args = buildScreencastPostProcessArgs({
      ...base,
      focusRect: { x: 800, y: 400, width: 200, height: 100 },
    });
    const vfIndex = args.indexOf('-vf');
    expect(args[vfIndex + 1]).toContain('zoompan');
  });

  it('encode toujours en H.264 yuv420p (compatibilité lecteurs)', () => {
    const args = buildScreencastPostProcessArgs(base);
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
  });
});
