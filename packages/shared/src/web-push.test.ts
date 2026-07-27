import { createECDH, createDecipheriv, hkdfSync, randomBytes, verify as cryptoVerify, generateKeyPairSync, createPublicKey } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  encryptPayload,
  sendWebPush,
  signVapidJwt,
  vapidPublicKeyToUint8Array,
  type PushSubscriptionKeys,
} from './web-push';

// CREDENTIALS_MASTER_KEY requis par getConfig() (masterKeySchema) — valeur de
// test uniquement, comme altcha.test.ts.
const TEST_MASTER_KEY = 'a'.repeat(64);

beforeEach(() => {
  process.env.CREDENTIALS_MASTER_KEY = TEST_MASTER_KEY;
  process.env.APP_URL = 'http://localhost:3000';
  process.env.MONGO_URI = 'mongodb://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.S3_ENDPOINT = 'http://localhost:9000';
  process.env.S3_ACCESS_KEY = 'test';
  process.env.S3_SECRET_KEY = 'test';
  process.env.S3_BUCKET = 'test';
  process.env.S3_REGION = 'us-east-1';
  process.env.AUTH_SECRET = 'test-secret-1234567890';
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

/** Génère une paire VAPID de test au format base64url attendu par la config. */
function generateTestVapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const privJwk = privateKey.export({ format: 'jwk' }) as { d: string };
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(pubJwk.x, 'base64url'),
    Buffer.from(pubJwk.y, 'base64url'),
  ]);
  return {
    publicKeyB64url: point.toString('base64url'),
    privateKeyB64url: privJwk.d,
  };
}

/** Simule un abonné navigateur : sa paire ECDH p256dh + son secret auth. */
function generateTestSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/test'): {
  subscription: PushSubscriptionKeys;
  clientEcdh: ReturnType<typeof createECDH>;
  authSecret: Buffer;
} {
  const clientEcdh = createECDH('prime256v1');
  clientEcdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    subscription: {
      endpoint,
      p256dh: clientEcdh.getPublicKey('base64url'),
      auth: authSecret.toString('base64url'),
    },
    clientEcdh,
    authSecret,
  };
}

/** Déchiffre un corps aes128gcm (RFC 8291) comme le ferait un navigateur — pour vérifier encryptPayload(). */
function decryptForTest(body: Buffer, clientEcdh: ReturnType<typeof createECDH>, authSecret: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idLen = body[20]!;
  const serverPublicKey = body.subarray(21, 21 + idLen);
  const rest = body.subarray(21 + idLen);
  const authTag = rest.subarray(rest.length - 16);
  const ciphertext = rest.subarray(0, rest.length - 16);

  const clientPublicKey = clientEcdh.getPublicKey();
  const sharedSecret = clientEcdh.computeSecret(serverPublicKey);
  const authInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), clientPublicKey, serverPublicKey]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, authInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));

  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(authTag);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return padded.subarray(0, padded.length - 1); // retire le delimiter de padding (0x02)
}

describe('encryptPayload (RFC 8291 aes128gcm)', () => {
  it('produit un message déchiffrable par le client avec le même contenu', () => {
    const { subscription, clientEcdh, authSecret } = generateTestSubscription();
    const plaintext = Buffer.from(JSON.stringify({ title: 'Cours prêt', body: 'Votre cours a été généré.' }));

    const { body, contentEncoding } = encryptPayload(plaintext, subscription);
    expect(contentEncoding).toBe('aes128gcm');

    const decrypted = decryptForTest(body, clientEcdh, authSecret);
    expect(decrypted.toString('utf8')).toBe(plaintext.toString('utf8'));
  });

  it('produit un salt et une clé éphémère différents à chaque appel (pas de réutilisation de nonce)', () => {
    const { subscription } = generateTestSubscription();
    const plaintext = Buffer.from('{}');

    const a = encryptPayload(plaintext, subscription);
    const b = encryptPayload(plaintext, subscription);

    expect(a.body.subarray(0, 16).equals(b.body.subarray(0, 16))).toBe(false); // salts différents
    expect(a.body.equals(b.body)).toBe(false);
  });
});

describe('signVapidJwt (RFC 8292)', () => {
  it('produit un JWT ES256 dont la signature est vérifiable avec la clé publique correspondante', () => {
    const { publicKeyB64url, privateKeyB64url } = generateTestVapidPair();

    const { jwt, headers } = signVapidJwt(
      'https://fcm.googleapis.com',
      'mailto:notifications@sallycourse.app',
      publicKeyB64url,
      privateKeyB64url,
    );

    const [h, p, s] = jwt.split('.');
    expect(h).toBeTruthy();
    expect(p).toBeTruthy();
    expect(s).toBeTruthy();

    const point = Buffer.from(publicKeyB64url, 'base64url');
    const pubKeyObj = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });

    const valid = cryptoVerify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: pubKeyObj, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s!, 'base64url'),
    );
    expect(valid).toBe(true);

    expect(headers.Authorization).toContain('vapid t=');
    expect(headers.Authorization).toContain(`k=${publicKeyB64url}`);
    expect(headers['Crypto-Key']).toBe(`p256ecdsa=${publicKeyB64url}`);
  });

  it('encode aud/sub dans le payload du JWT', () => {
    const { publicKeyB64url, privateKeyB64url } = generateTestVapidPair();
    const { jwt } = signVapidJwt('https://updates.push.services.mozilla.com', 'mailto:test@sallycourse.app', publicKeyB64url, privateKeyB64url);

    const payloadJson = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'));
    expect(payloadJson.aud).toBe('https://updates.push.services.mozilla.com');
    expect(payloadJson.sub).toBe('mailto:test@sallycourse.app');
    expect(payloadJson.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('sendWebPush — mode mock (VAPID absent)', () => {
  it('retourne { ok: true, mock: true } sans appel réseau si VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY absents', async () => {
    const { subscription } = generateTestSubscription();
    const result = await sendWebPush(subscription, { title: 'Test', body: 'Corps' });
    expect(result).toEqual({ ok: true, mock: true });
  });
});

describe('vapidPublicKeyToUint8Array', () => {
  it('décode la clé publique base64url en Uint8Array de 65 octets (point EC non compressé)', () => {
    const { publicKeyB64url } = generateTestVapidPair();
    const arr = vapidPublicKeyToUint8Array(publicKeyB64url);
    expect(arr).toBeInstanceOf(Uint8Array);
    expect(arr.length).toBe(65);
    expect(arr[0]).toBe(0x04);
  });
});
