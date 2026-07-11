// Garde SSRF générique (Prompt 116 — audit OWASP) : réutilisée par les
// adapters de déploiement qui appellent une URL fournie par l'utilisateur
// dans ses credentials de plateforme (Moodle.baseUrl, WordPress.siteUrl…).
// Logique identique à la garde déjà en place pour les captures Playwright
// (media/screenshot-capture.ts, Prompt 21) — dupliquée volontairement ici
// plutôt que ré-exportée : `deploy/` ne doit pas dépendre de `media/`
// (Playwright n'est pas nécessaire pour ce garde-fou), et le fichier source
// reste inchangé (déjà testé, on ne le retouche pas pour ce prompt).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Erreur de garde SSRF — URL refusée avant tout appel réseau sortant. */
export class SsrfBlockedError extends Error {
  readonly url: string;
  constructor(message: string, url: string) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.url = url;
  }
}

/** Vrai si l'IP (v4 ou v6) est privée, loopback, lien-local ou métadonnée cloud. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // lien-local + 169.254.169.254 (métadonnées)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast + réservé
    return false;
  }
  if (version === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true; // loopback / non spécifié
    if (low.startsWith('fe80')) return true; // lien-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true; // unique-local fc00::/7
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // ni v4 ni v6 : on refuse par prudence.
}

/**
 * Valide une URL de credential plateforme (Moodle.baseUrl, WordPress.siteUrl…)
 * avant le PREMIER appel réseau : schéma http/https uniquement, hôte non vide,
 * et TOUTES les IP résolues hors plages privées/métadonnées cloud. Jette une
 * SsrfBlockedError explicite si l'URL est interdite — l'appelant doit la
 * traduire en échec d'authentification/déploiement (pas de fetch tenté).
 *
 * Ces URLs sont saisies par le propriétaire du compte (pas une entrée tierce
 * arbitraire), mais restent une source non fiable : un compte compromis ou un
 * utilisateur malveillant pourrait viser une IP interne (169.254.169.254,
 * réseau Docker mongo/redis/minio) pour sonder l'infrastructure ou exfiltrer
 * via les messages d'erreur qui renvoient un extrait de la réponse HTTP.
 */
export async function assertHostAllowed(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`URL invalide : « ${rawUrl} »`, rawUrl);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(`schéma « ${parsed.protocol} » refusé (http/https requis)`, rawUrl);
  }
  const host = parsed.hostname;
  if (!host) throw new SsrfBlockedError('hôte absent', rawUrl);

  const loweredHost = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (loweredHost === 'localhost' || loweredHost.endsWith('.localhost')) {
    throw new SsrfBlockedError(`hôte local refusé : « ${host} »`, rawUrl);
  }

  if (isIP(loweredHost)) {
    if (isBlockedIp(loweredHost)) {
      throw new SsrfBlockedError(`IP privée/réservée refusée : ${loweredHost}`, rawUrl);
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(loweredHost, { all: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SsrfBlockedError(`résolution DNS impossible pour « ${host} » — ${reason}`, rawUrl);
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`aucune IP résolue pour « ${host} »`, rawUrl);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfBlockedError(
        `« ${host} » résout vers une IP privée/réservée (${address}) — refusé`,
        rawUrl,
      );
    }
  }
}
