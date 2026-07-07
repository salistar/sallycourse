// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
import { encryptSecret, decryptSecret } from './crypto';

// Helpers réutilisables de (dé)chiffrement des credentials plateformes.
// Un credential est un Record<string,string> (email/password, apiKey, tokens…)
// sérialisé en JSON puis chiffré en un blob unique AES-256-GCM. Ces helpers
// sont partagés entre le web (API /platforms) et le worker (adapters de deploy).

/** Sac de credentials déchiffré — aligné sur DeployCredentials du worker (P31). */
export type PlatformCredentialData = Record<string, string>;

/** Sérialise + chiffre un sac de credentials en un blob "v1:iv:tag:data". */
export function encryptCredentials(
  data: PlatformCredentialData,
  masterKeyHex: string,
): string {
  return encryptSecret(JSON.stringify(data), masterKeyHex);
}

/** Déchiffre + désérialise un blob credentials ; jette si clé/format invalide. */
export function decryptCredentials(
  blob: string,
  masterKeyHex: string,
): PlatformCredentialData {
  const parsed: unknown = JSON.parse(decryptSecret(blob, masterKeyHex));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Credentials déchiffrés invalides : objet clé→valeur attendu.');
  }
  // On force des valeurs string (les blobs légitimes n'en contiennent que).
  const out: PlatformCredentialData = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] = typeof value === 'string' ? value : String(value);
  }
  return out;
}

/** Champs considérés secrets — masqués dans toute sortie/log. */
const SECRET_KEYS = /pass|secret|token|key|refresh|access/i;

/**
 * Version masquée d'un sac de credentials pour logs/réponses API : chaque
 * valeur sensible devient "•••" (les clés non sensibles restent lisibles pour
 * le diagnostic, ex. « email »).
 */
export function redactCredentials(
  data: PlatformCredentialData,
): PlatformCredentialData {
  const out: PlatformCredentialData = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = SECRET_KEYS.test(key) ? '•••' : value;
  }
  return out;
}
