#!/usr/bin/env node
// Génère une paire de clés VAPID (P156 — Web Push natif, sans Firebase/lib
// 'web-push'). Utilise uniquement node:crypto (courbe P-256 / prime256v1,
// celle exigée par le protocole VAPID/Web Push RFC 8292).
//
// Sortie : clé publique + clé privée encodées en base64url, au format attendu
// par apps/web/src/lib/web-push.ts et par PushManager.subscribe() côté
// navigateur (applicationServerKey = clé publique décodée en Uint8Array).
//
// Usage :
//   node scripts/generate-vapid-keys.mjs
//   → copier VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY dans .env

import { generateKeyPairSync } from 'node:crypto';

/** Base64 standard → base64url (RFC 4648 §5), sans padding. */
function toBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1', // = P-256, exigé par VAPID (RFC 8292)
});

const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });

// Clé publique VAPID = point EC non compressé (0x04 || x || y), 65 octets,
// encodé en base64url — format attendu tel quel par applicationServerKey.
const x = Buffer.from(pubJwk.x, 'base64url');
const y = Buffer.from(pubJwk.y, 'base64url');
const uncompressedPoint = Buffer.concat([Buffer.from([0x04]), x, y]);
const publicKeyB64Url = toBase64Url(uncompressedPoint.toString('base64'));

// Clé privée VAPID = scalaire brut `d` (32 octets), encodé en base64url —
// c'est CE format qu'attend l'implémentation JWT ES256 de web-push.ts (elle
// reconstruit la clé privée EC complète à partir de d + de la courbe).
const privateKeyB64Url = toBase64Url(Buffer.from(privJwk.d, 'base64url').toString('base64'));

console.log('✓ Paire de clés VAPID générée (P-256).\n');
console.log('Ajoutez ces lignes à votre .env :\n');
console.log(`VAPID_PUBLIC_KEY=${publicKeyB64Url}`);
console.log(`VAPID_PRIVATE_KEY=${privateKeyB64Url}`);
console.log(`VAPID_SUBJECT=mailto:notifications@sallycourse.app\n`);
console.log(
  'La clé publique est aussi exposée au navigateur via NEXT_PUBLIC_VAPID_PUBLIC_KEY',
);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKeyB64Url}`);
