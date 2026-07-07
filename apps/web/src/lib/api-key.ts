import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Génération et vérification des clés API de l'API publique v1 (Prompt 51).
 * Logique PURE (aucun accès réseau/DB) — testable en isolation.
 *
 * Format d'une clé : `sk_live_<32 octets base64url>`. On stocke uniquement le
 * hash SHA-256 (jamais la clé) plus un préfixe court affichable. La clé en clair
 * n'existe qu'au moment de la création, renvoyée une seule fois à l'utilisateur.
 */

/** Préfixe distinctif : reconnaît une clé SallyCourse et évite les collisions. */
export const API_KEY_PREFIX = 'sk_live_';

/** Nombre de caractères du préfixe public conservé (prefix du modèle ApiKey). */
const PUBLIC_PREFIX_LEN = API_KEY_PREFIX.length + 8;

export interface GeneratedApiKey {
  /** Clé complète en clair — à afficher UNE fois, jamais persistée. */
  key: string;
  /** Hash SHA-256 (hex) stocké en base. */
  hashedKey: string;
  /** Préfixe public (ex. "sk_live_ab12cd34") pour l'affichage/repérage. */
  prefix: string;
}

/** Hash SHA-256 hexadécimal d'une clé — déterministe, pour stockage et lookup. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Extrait le préfixe public affichable d'une clé complète. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, PUBLIC_PREFIX_LEN);
}

/** Génère une nouvelle clé API : clair (une fois), hash et préfixe. */
export function generateApiKey(): GeneratedApiKey {
  // base64url sans padding → sûr en en-tête HTTP et dans une URL.
  const random = randomBytes(32).toString('base64url');
  const key = `${API_KEY_PREFIX}${random}`;
  return { key, hashedKey: hashApiKey(key), prefix: apiKeyPrefix(key) };
}

/**
 * Vérifie qu'une clé présentée correspond à un hash stocké, en temps constant
 * (anti timing-attack). Compare les hashes hex, pas les clés en clair.
 */
export function verifyApiKey(presentedKey: string, storedHash: string): boolean {
  const presentedHash = hashApiKey(presentedKey);
  const a = Buffer.from(presentedHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Vrai si la chaîne a la forme d'une clé SallyCourse (garde rapide). */
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length > PUBLIC_PREFIX_LEN;
}
