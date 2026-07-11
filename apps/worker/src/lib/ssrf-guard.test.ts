// Tests unitaires de la garde SSRF partagée (Prompt 116 — audit OWASP),
// utilisée par les adapters de déploiement self-hosted (Moodle, WordPress).
// Aucune dépendance réseau réelle hors résolution DNS (comme le module miroir
// media/screenshot-capture.test.ts).
import { describe, expect, it } from 'vitest';
import { SsrfBlockedError, assertHostAllowed, isBlockedIp } from './ssrf-guard.js';

describe('isBlockedIp', () => {
  it('bloque les IPv4 privées, loopback, lien-local et métadonnées', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it('autorise les IPv4 publiques', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it('bloque loopback et unique-local IPv6, y compris IPv4 mappée privée', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('refuse une chaîne non-IP', () => {
    expect(isBlockedIp('pas-une-ip')).toBe(true);
  });
});

describe('assertHostAllowed', () => {
  it('refuse localhost et les sous-domaines .localhost sans résoudre', async () => {
    await expect(assertHostAllowed('http://localhost:3000/webservice/rest/server.php')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertHostAllowed('http://moodle.localhost/')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('refuse une IP littérale privée (ex. réseau Docker interne)', async () => {
    await expect(assertHostAllowed('http://127.0.0.1:8080/wp-json/wp/v2')).rejects.toThrow(/privée|réservée/i);
    await expect(assertHostAllowed('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertHostAllowed('http://10.0.0.5/webservice/rest/server.php')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('refuse les schémas non http/https', async () => {
    await expect(assertHostAllowed('file:///etc/passwd')).rejects.toThrow(/schéma/);
    await expect(assertHostAllowed('ftp://example.com/')).rejects.toThrow(/schéma/);
  });

  it('accepte une IP publique littérale (site self-hosted légitime)', async () => {
    await expect(assertHostAllowed('https://8.8.8.8/wp-json/wp/v2')).resolves.toBeUndefined();
  });
});
