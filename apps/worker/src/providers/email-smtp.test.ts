// Tests des fonctions pures d'email-smtp (Prompt 151) : parsing SMTP_URL et
// construction du message brut RFC 5322. Aucun socket réel ouvert ici — voir
// email-smtp.ts::sendViaSocket pour la partie réseau (non testée en pur).
import { describe, expect, it } from 'vitest';
import { buildRawMessage, parseSmtpUrl } from './email-smtp.js';

describe('parseSmtpUrl', () => {
  it('parse host+port sans authentification (mailpit)', () => {
    expect(parseSmtpUrl('smtp://localhost:1025')).toEqual({
      host: 'localhost',
      port: 1025,
      user: undefined,
      pass: undefined,
    });
  });

  it('parse user:pass@host:port', () => {
    expect(parseSmtpUrl('smtp://alice:s3cret@relay.example.com:587')).toEqual({
      host: 'relay.example.com',
      port: 587,
      user: 'alice',
      pass: 's3cret',
    });
  });

  it('port par défaut 25 si absent', () => {
    expect(parseSmtpUrl('smtp://relay.example.com').port).toBe(25);
  });

  it('rejette un protocole autre que smtp:', () => {
    expect(() => parseSmtpUrl('http://relay.example.com')).toThrow(/protocole/);
  });
});

describe('buildRawMessage', () => {
  it('construit un message RFC 5322 minimal avec en-têtes + corps HTML', () => {
    const raw = buildRawMessage('from@x.com', 'to@y.com', 'Sujet', '<p>Bonjour</p>');
    expect(raw).toContain('From: from@x.com');
    expect(raw).toContain('To: to@y.com');
    expect(raw).toContain('Subject: Sujet');
    expect(raw).toContain('Content-Type: text/html; charset=utf-8');
    expect(raw).toContain('<p>Bonjour</p>');
  });
});
