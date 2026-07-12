import {
  createECDH,
  createCipheriv,
  hkdfSync,
  randomBytes,
  sign as cryptoSign,
  createPrivateKey,
} from 'node:crypto';
import { getConfig } from '@sallycourse/shared';

/**
 * Web Push natif (Prompt 156) — envoi de notifications navigateur SANS
 * Firebase ni la lib `web-push` : implémentation directe des deux RFC du
 * protocole Web Push, en s'appuyant uniquement sur `node:crypto` :
 *   - RFC 8292 (VAPID) : JWT ES256 signé par notre clé privée, prouve au push
 *     service (FCM/Mozilla) que l'envoi vient d'un serveur autorisé.
 *   - RFC 8291 (aes128gcm) : chiffrement de la charge utile avec une clé
 *     éphémère ECDH + dérivation HKDF, déchiffrable uniquement par le
 *     navigateur abonné (p256dh/auth de la subscription).
 *
 * MOCK-FRIENDLY : si VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY sont absentes
 * (packages/shared/src/config.ts), `sendWebPush` journalise et retourne un
 * résultat mock — jamais d'échec bloquant du pipeline appelant (même garantie
 * que packages/db/src/email/send.ts).
 *
 * Si l'écosystème préfère une implémentation éprouvée en production, la lib
 * `web-push` (npm) couvre le même protocole avec plus de tests communautaires
 * — voir depsNeeded ci-dessous, non installée ici (pas d'exécution de
 * `pnpm install` sans instruction explicite).
 */

/** Décode une chaîne base64url (subscription keys, clés VAPID) en Buffer. */
function b64urlToBuffer(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function bufferToB64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  /** Lien ouvert au clic (relatif ou absolu) — géré par le service worker côté client. */
  url?: string;
}

export interface SendWebPushResult {
  ok: boolean;
  /** true si VAPID est absent (mode mock — aucun envoi réseau). */
  mock: boolean;
  status?: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* RFC 8292 — VAPID : JWT ES256 signé                                   */
/* ------------------------------------------------------------------ */

function base64urlJson(value: unknown): string {
  return bufferToB64url(Buffer.from(JSON.stringify(value)));
}

/**
 * Reconstruit une clé privée EC (PKCS8/DER) utilisable par node:crypto à
 * partir du scalaire brut `d` (32 octets, format VAPID_PRIVATE_KEY) — évite
 * toute dépendance externe pour la conversion JWK → PEM.
 */
function privateKeyFromRawD(dB64url: string) {
  const d = b64urlToBuffer(dB64url);
  if (d.length !== 32) {
    throw new Error('VAPID_PRIVATE_KEY invalide (doit décoder en 32 octets base64url).');
  }
  // Dérive le point public (x, y) depuis d via ECDH — un JWK EC complet exige
  // x/y en plus de d pour être importable par createPrivateKey().
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // point non compressé 0x04||x||y (65 octets)
  const x = pub.subarray(1, 33);
  const y = pub.subarray(33, 65);

  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: bufferToB64url(d),
      x: bufferToB64url(x),
      y: bufferToB64url(y),
    },
    format: 'jwk',
  });
}

export interface VapidHeaders {
  Authorization: string;
  'Crypto-Key': string;
}

/**
 * Signe un JWT ES256 minimal {typ,alg}.{aud,exp,sub}.{signature} — aucune
 * librairie JWT : l'algorithme ES256 (ECDSA P-256 + SHA-256) est directement
 * supporté par node:crypto (`sign(..., { dsaEncoding: 'ieee-p1363' })` produit
 * la signature au format brut r||s attendu par JWS, pas le DER par défaut).
 */
export function signVapidJwt(
  audience: string,
  subject: string,
  publicKeyB64url: string,
  privateKeyB64url: string,
  expSeconds = 12 * 60 * 60,
): { jwt: string; headers: VapidHeaders } {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + expSeconds,
    sub: subject,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;

  const privateKey = privateKeyFromRawD(privateKeyB64url);
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363', // r||s brut (64 octets) — format JWS, pas ASN.1 DER
  });

  const jwt = `${signingInput}.${bufferToB64url(signature)}`;

  return {
    jwt,
    headers: {
      Authorization: `vapid t=${jwt}, k=${publicKeyB64url}`,
      'Crypto-Key': `p256ecdsa=${publicKeyB64url}`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* RFC 8291 — aes128gcm : chiffrement de la charge utile                */
/* ------------------------------------------------------------------ */

/** Résultat du chiffrement : corps binaire prêt à POSTer + content-encoding. */
export interface EncryptedPayload {
  body: Buffer;
  contentEncoding: 'aes128gcm';
}

/**
 * Chiffre `plaintext` pour la subscription donnée selon RFC 8291 (aes128gcm) :
 * clé éphémère ECDH serveur + secret partagé ECDH avec la clé p256dh client,
 * dérivation HKDF (info "WebPush: info" puis "Content-Encoding: aes128gcm"),
 * padding minimal (delimiter 0x02), chiffrement AES-128-GCM avec le nonce
 * dérivé. Format du corps : salt(16) || rs(4) || keyid_len(1) || keyid ||
 * ciphertext+tag.
 */
export function encryptPayload(
  plaintext: Buffer,
  subscription: PushSubscriptionKeys,
): EncryptedPayload {
  const clientPublicKey = b64urlToBuffer(subscription.p256dh); // point non compressé (65 octets)
  const authSecret = b64urlToBuffer(subscription.auth); // 16 octets

  // Clé éphémère serveur (une par message — jamais réutilisée).
  const serverEcdh = createECDH('prime256v1');
  serverEcdh.generateKeys();
  const serverPublicKey = serverEcdh.getPublicKey(); // 65 octets

  const sharedSecret = serverEcdh.computeSecret(clientPublicKey);

  const salt = randomBytes(16);

  // PRK = HMAC-SHA256(auth_secret, ecdh_secret) — étape "auth" du RFC 8291 §3.3.
  const authInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    clientPublicKey,
    serverPublicKey,
  ]);
  const ikm = Buffer.from(
    hkdfSync('sha256', sharedSecret, authSecret, authInfo, 32),
  );

  // Clé de chiffrement de contenu (CEK, 16 octets) et nonce (12 octets),
  // dérivés du IKM via HKDF avec le salt du message.
  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'utf8');
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, cekInfo, 16));

  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'utf8');
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, nonceInfo, 12));

  // Padding minimal : un seul enregistrement, delimiter 0x02 puis 0 octet de
  // remplissage (RFC 8188 §2 — dernier enregistrement du flux = delimiter 2).
  const padded = Buffer.concat([plaintext, Buffer.from([0x02])]);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // En-tête aes128gcm (RFC 8188 §2) : salt(16) || record_size(4, BE) || idlen(1) || keyid.
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const header = Buffer.concat([
    salt,
    recordSize,
    Buffer.from([serverPublicKey.length]),
    serverPublicKey,
  ]);

  return {
    body: Buffer.concat([header, ciphertext, authTag]),
    contentEncoding: 'aes128gcm',
  };
}

/* ------------------------------------------------------------------ */
/* Envoi                                                                */
/* ------------------------------------------------------------------ */

/**
 * Envoie une notification push à un abonnement. Best-effort : ne jette
 * jamais — retourne `{ ok: false }` en cas d'échec réseau/HTTP, `{ mock:
 * true }` si VAPID n'est pas configuré (aucun envoi réel).
 */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: WebPushPayload,
): Promise<SendWebPushResult> {
  let config;
  try {
    config = getConfig();
  } catch {
    config = {} as ReturnType<typeof getConfig>;
  }

  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    console.info(
      `[web-push:mock] → ${subscription.endpoint.slice(0, 60)}… · "${payload.title}" (VAPID non configuré)`,
    );
    return { ok: true, mock: true };
  }

  try {
    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

    const { headers: vapidHeaders } = signVapidJwt(
      audience,
      config.VAPID_SUBJECT,
      config.VAPID_PUBLIC_KEY,
      config.VAPID_PRIVATE_KEY,
    );

    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const { body, contentEncoding } = encryptPayload(plaintext, subscription);

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        ...vapidHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': contentEncoding,
        TTL: '86400',
      },
      // BodyInit n'accepte pas Buffer directement dans le typage lib.dom —
      // Uint8Array (vue sans copie sur le même ArrayBuffer) satisfait le type.
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, mock: false, status: res.status, error: detail.slice(0, 200) };
    }
    return { ok: true, mock: false, status: res.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[web-push] échec d'envoi vers ${subscription.endpoint.slice(0, 60)}… : ${error}`);
    return { ok: false, mock: false, error };
  }
}

/**
 * Encodage d'une clé publique VAPID pour PushManager.subscribe côté client
 * (applicationServerKey attend un Uint8Array/ArrayBuffer — l'API browser
 * n'accepte pas directement la chaîne base64url).
 */
export function vapidPublicKeyToUint8Array(publicKeyB64url: string): Uint8Array {
  return new Uint8Array(b64urlToBuffer(publicKeyB64url));
}

// depsNeeded (optionnel, PAS installé ici) : 'web-push' — si l'implémentation
// maison ci-dessus doit être remplacée par une lib éprouvée en production,
// `web-push` (npm) couvre le même protocole VAPID + aes128gcm avec plus de
// couverture communautaire (gestion des variantes de push services, retry).
