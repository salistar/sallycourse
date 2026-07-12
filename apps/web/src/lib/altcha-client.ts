/**
 * ALTCHA (P159) — résolution côté client de la preuve de travail. Logique
 * PURE (pas de fetch ici, juste le brute-force sha256 via Web Crypto natif
 * du navigateur) : appelée par le composant client `AltchaWidget` après
 * récupération d'un challenge via GET /api/altcha.
 *
 * N'importe rien de '@sallycourse/design' (règle composants client) ni de
 * dépendance externe — Web Crypto (window.crypto.subtle) suffit.
 */

export interface AltchaChallengePayload {
  algorithm: string;
  challenge: string;
  salt: string;
  maxnumber: number;
  signature: string;
}

export interface AltchaSolvedPayload extends AltchaChallengePayload {
  number: number;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Force brute 0..maxnumber jusqu'à retrouver le nombre secret tel que
 * sha256(salt + number) === challenge. Coût CPU volontairement modéré
 * (maxnumber par défaut 100000 côté serveur, cf. lib/altcha.ts).
 */
export async function solveAltchaChallenge(
  payload: AltchaChallengePayload,
): Promise<AltchaSolvedPayload> {
  const { salt, challenge, maxnumber } = payload;
  for (let number = 0; number <= maxnumber; number += 1) {
    const hash = await sha256Hex(salt + number);
    if (hash === challenge) {
      return { ...payload, number };
    }
  }
  // Ne devrait jamais arriver (le serveur garantit number <= maxnumber) :
  // repli sur -1, rejeté côté serveur (preuve de travail incorrecte).
  return { ...payload, number: -1 };
}
