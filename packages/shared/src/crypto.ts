import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Chiffrement des credentials plateformes (Udemy, etc.) en AES-256-GCM.
// Format de blob versionné : "v1:<iv b64>:<tag b64>:<data b64>" — la version
// en tête permet une rotation d'algorithme sans casser les blobs existants.

const VERSION = 'v1';
const IV_BYTES = 12; // taille d'IV recommandée pour GCM
const TAG_BYTES = 16;

/** Valide la clé maître (64 caractères hex = 32 octets) et la décode. */
function parseMasterKey(masterKeyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
    throw new Error(
      'Clé maître invalide : attendu 64 caractères hexadécimaux (32 octets, `openssl rand -hex 32`).',
    );
  }
  return Buffer.from(masterKeyHex, 'hex');
}

/** Chiffre un secret en AES-256-GCM ; retourne un blob "v1:iv:tag:data" (base64). */
export function encryptSecret(plain: string, masterKeyHex: string): string {
  const key = parseMasterKey(masterKeyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

/** Déchiffre un blob "v1:iv:tag:data" ; jette si clé incorrecte ou blob corrompu. */
export function decryptSecret(blob: string, masterKeyHex: string): string {
  const key = parseMasterKey(masterKeyHex);

  const parts = blob.split(':');
  if (parts.length !== 4) {
    throw new Error('Blob chiffré invalide : format attendu "v1:<iv>:<tag>:<data>".');
  }
  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new Error(`Version de blob non supportée : "${version}" (attendu "${VERSION}").`);
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Blob chiffré invalide : IV ou tag d’authentification malformé.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // GCM échoue à l'authentification : mauvaise clé ou données altérées.
    throw new Error('Déchiffrement impossible : clé incorrecte ou blob corrompu.');
  }
}
