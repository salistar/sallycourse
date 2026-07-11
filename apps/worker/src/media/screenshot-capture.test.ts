// Tests unitaires du cœur de capture : garde SSRF (assertUrlAllowed/isBlockedIp)
// et lecture d'en-tête PNG. Aucune dépendance réseau ni navigateur réel.
import { describe, expect, it } from 'vitest';
import {
  ScreenshotCaptureError,
  assertUrlAllowed,
  hashScreenshotSpec,
  isBlockedIp,
  readPngSize,
} from './screenshot-capture.js';
import type { TpScreenshotSpec } from '../shared.js';

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
