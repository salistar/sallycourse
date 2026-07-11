import { randomBytes } from 'node:crypto';

/**
 * Affiliation (Prompt 89) : génération de code unique + calcul de commission.
 * Logique PURE (aucun accès réseau/DB) — testable en isolation. L'écriture en
 * base (unicité réelle, crédit du montant) vit dans les routes/actions.
 */

/** Alphabet sans caractères ambigus (0/O, 1/I/l) — code lisible à l'oral/écrit. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/** Nom du cookie de tracking posé au clic sur un lien d'affiliation. */
export const AFFILIATE_COOKIE_NAME = 'sc_ref';
/** Durée de validité du cookie de tracking — 30 jours (en secondes). */
export const AFFILIATE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Taux de commission par défaut appliqué aux nouveaux liens (20 %). */
export const DEFAULT_COMMISSION_RATE = 0.2;

/**
 * Génère un code d'affiliation aléatoire (8 caractères, alphabet restreint).
 * Non déterministe par construction — l'appelant doit vérifier l'unicité en
 * base et régénérer en cas de collision (voir `generateUniqueAffiliateCode`).
 */
export function generateAffiliateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return code;
}

/** Vrai si la chaîne a la forme d'un code d'affiliation valide. */
export function isValidAffiliateCode(value: string): boolean {
  if (value.length !== CODE_LENGTH) return false;
  return [...value].every((ch) => CODE_ALPHABET.includes(ch));
}

/**
 * Génère un code unique en interrogeant `exists` (typiquement un lookup DB) ;
 * borne le nombre d'essais pour éviter une boucle infinie en cas d'anomalie.
 */
export async function generateUniqueAffiliateCode(
  exists: (code: string) => Promise<boolean>,
  maxAttempts = 10,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateAffiliateCode();
    if (!(await exists(code))) return code;
  }
  throw new Error('Impossible de générer un code d’affiliation unique après plusieurs essais.');
}

/**
 * Calcule la commission (USD) due sur un montant payé, arrondie au centime.
 * `amountUsd` doit être positif ; un taux hors [0,1] est borné pour rester
 * sans danger même si une valeur incohérente venait à être stockée.
 */
export function computeCommissionUsd(amountUsd: number, commissionRate: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0;
  const rate = Math.min(Math.max(commissionRate, 0), 1);
  return Math.round(amountUsd * rate * 100) / 100;
}

/** Convertit un montant en plus petite unité (centimes) + devise vers des USD approximatifs. */
const EUR_TO_USD_RATE = 1.08;
const MAD_TO_USD_RATE = 0.1;

export function toApproxUsd(amountMinor: number, currency: 'EUR' | 'MAD' | 'USD'): number {
  const major = amountMinor / 100;
  if (currency === 'USD') return major;
  if (currency === 'EUR') return Math.round(major * EUR_TO_USD_RATE * 100) / 100;
  return Math.round(major * MAD_TO_USD_RATE * 100) / 100;
}

/** URL publique de partage pour un code d'affiliation, à partir de l'URL de base de l'app. */
export function affiliateShareUrl(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/$/, '')}/r/${code}`;
}
