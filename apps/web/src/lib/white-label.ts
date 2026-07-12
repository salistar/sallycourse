/**
 * Sous-domaines white-label (Prompt 143, plan Business) : détection PURE du
 * sous-domaine de la requête (aucun import Mongoose ici — ce module est
 * importé par middleware.ts qui tourne en Edge Runtime, incompatible avec le
 * code de Mongoose). La résolution I/O du branding (Mongo) vit dans
 * white-label.server.ts, importé uniquement par du code Node classique
 * (route handlers/Server Components), jamais par le middleware.
 */

/** Domaine racine de production ; surchageable via NEXT_PUBLIC_ROOT_DOMAIN. */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim().toLowerCase() || 'sallycourse.com';

/** Hôtes qui ne portent jamais de sous-domaine white-label (dev local, previews Vercel...). */
const BARE_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Extrait le sous-domaine white-label d'un header Host (ex.
 * "academie-client.sallycourse.com:443" → "academie-client"). PURE.
 * Retourne `null` quand :
 *   - l'hôte est le domaine racine nu (sallycourse.com, www.sallycourse.com) ;
 *   - l'hôte est un hôte de dev sans sous-domaine (localhost, IP) ;
 *   - l'hôte ne se termine pas par le domaine racine configuré (autre domaine,
 *     custom domain non encore supporté — voir docs/WHITE-LABEL-DNS.md).
 */
export function extractSubdomain(host: string | null | undefined, rootDomain: string = ROOT_DOMAIN): string | null {
  if (!host) return null;
  // Retire le port éventuel (":3000", ":443"...).
  const hostname = host.split(':')[0]?.trim().toLowerCase() ?? '';
  if (!hostname) return null;

  if (BARE_HOSTS.has(hostname)) return null;

  // Dev local : "academie-client.localhost" (pratique pour tester sans DNS réel).
  if (hostname.endsWith('.localhost')) {
    const sub = hostname.slice(0, -'.localhost'.length);
    return sub && sub !== 'www' ? sub : null;
  }

  if (hostname === rootDomain || hostname === `www.${rootDomain}`) return null;
  if (!hostname.endsWith(`.${rootDomain}`)) return null;

  const sub = hostname.slice(0, -(rootDomain.length + 1));
  if (!sub || sub.includes('.') || sub === 'www') return null;
  return sub;
}

export interface WhiteLabelSite {
  ownerId: string;
  schoolName: string;
  logoKey?: string;
  primaryColorHex: string;
  accentColorHex: string;
}
