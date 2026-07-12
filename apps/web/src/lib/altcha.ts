import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * ALTCHA (P159) — anti-bot self-hosted, preuve de travail (proof-of-work),
 * sans tracking ni service tiers. Implémentation interne du protocole
 * standard ALTCHA (https://altcha.org/docs/challenge-api) : pas de
 * dépendance externe (`altcha-lib` n'est pas requis), Node `crypto` suffit.
 *
 * Principe :
 *  1. Le serveur génère un challenge = sha256(salt + nombre secret aléatoire
 *     `number` compris entre 0 et `maxNumber`), et signe {algorithm, challenge,
 *     salt, maxNumber} avec une clé HMAC secrète (signature = anti-triche :
 *     empêche le client de forger un challenge trivial côté navigateur).
 *  2. Le client doit retrouver `number` par force brute (0, 1, 2, ...) tel que
 *     sha256(salt + number) === challenge, puis renvoie {algorithm, challenge,
 *     salt, number, signature}.
 *  3. Le serveur revérifie sha256(salt + number) === challenge ET la
 *     signature HMAC — les deux doivent correspondre.
 *
 * Coût réglable via `maxNumber` (P159 défaut 100000, ~quelques dizaines de ms
 * de calcul navigateur) : assez pour décourager un bot naïf sans pénaliser
 * l'UX humaine.
 */

const ALGORITHM = 'SHA-256' as const;

/** Nombre max de l'espace de recherche — coût du calcul côté client. */
const DEFAULT_MAX_NUMBER = 100_000;

/** Durée de validité d'un challenge émis (évite le rejeu tardif). */
const CHALLENGE_TTL_SEC = 600;

export interface AltchaChallenge {
  algorithm: typeof ALGORITHM;
  challenge: string;
  salt: string;
  maxnumber: number;
  signature: string;
}

export interface AltchaSolution {
  algorithm?: string;
  challenge: string;
  salt: string;
  number: number;
  signature: string;
}

/**
 * Clé HMAC utilisée pour signer/vérifier les challenges (clé locale, pas
 * d'API tierce). Lue directement sur `process.env` (et non via
 * `getConfig()`/Zod) pour ne pas coupler ce module pur à la validation
 * complète de la configuration applicative (MONGO_URI, S3_*, etc.), qui
 * rendrait les tests unitaires d'ALTCHA dépendants de tout l'environnement.
 * Réutilise CREDENTIALS_MASTER_KEY (déjà requise en production, 32 octets
 * hex) avec repli sur AUTH_SECRET si absente (dev/test) — jamais de valeur
 * en dur : une signature prévisible casserait la protection anti-triche.
 */
function getHmacKey(): string {
  const key = process.env.CREDENTIALS_MASTER_KEY ?? process.env.AUTH_SECRET;
  if (!key) {
    throw new Error(
      'CREDENTIALS_MASTER_KEY (ou AUTH_SECRET) requis pour signer les challenges ALTCHA.',
    );
  }
  return key;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmacHex(input: string): string {
  return createHmac('sha256', getHmacKey()).update(input).digest('hex');
}

/** Le salt encode son expiration (`expires=<epoch sec>`) — vérifié à la résolution. */
function buildSalt(expiresAtSec: number): string {
  return `${randomBytes(12).toString('hex')}.expires=${expiresAtSec}`;
}

function saltExpired(salt: string): boolean {
  const match = /expires=(\d+)/.exec(salt);
  if (!match) return true;
  const expiresAtSec = Number(match[1]);
  return Number.isNaN(expiresAtSec) || Date.now() / 1000 > expiresAtSec;
}

/**
 * Génère un nouveau challenge ALTCHA à envoyer au client (POST /api/altcha ou
 * embarqué dans la page). `maxNumber` réglable pour ajuster le coût CPU.
 */
export function createAltchaChallenge(maxNumber: number = DEFAULT_MAX_NUMBER): AltchaChallenge {
  const number = Math.floor(Math.random() * maxNumber);
  const expiresAtSec = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC;
  const salt = buildSalt(expiresAtSec);
  const challenge = sha256Hex(salt + number);
  const signature = hmacHex(challenge);

  return { algorithm: ALGORITHM, challenge, salt, maxnumber: maxNumber, signature };
}

export interface AltchaVerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * Vérifie une solution soumise par le client : recalcule sha256(salt+number)
 * et compare au challenge signé, revérifie la signature HMAC, et rejette les
 * challenges expirés (TTL) ou déjà consommés (voir `consumeAltchaChallenge`
 * pour la protection anti-rejeu côté appelant, ex: Redis SETNX).
 */
export function verifyAltchaSolution(solution: AltchaSolution): AltchaVerifyResult {
  if (!solution || typeof solution.number !== 'number' || !Number.isFinite(solution.number)) {
    return { valid: false, reason: 'Solution invalide.' };
  }
  if (!solution.challenge || !solution.salt || !solution.signature) {
    return { valid: false, reason: 'Champs manquants.' };
  }
  if (saltExpired(solution.salt)) {
    return { valid: false, reason: 'Challenge expiré, rechargez la page.' };
  }

  const expectedSignature = hmacHex(solution.challenge);
  if (expectedSignature !== solution.signature) {
    return { valid: false, reason: 'Signature invalide.' };
  }

  const recomputed = sha256Hex(solution.salt + solution.number);
  if (recomputed !== solution.challenge) {
    return { valid: false, reason: 'Preuve de travail incorrecte.' };
  }

  return { valid: true };
}
