/**
 * Protection CSRF pour les routes API classiques (P76 — audit sécurité).
 *
 * Contexte : les Server Actions Next.js (src/app/actions/*) sont protégées
 * nativement par Next (vérification d'Origin sur l'en-tête `Next-Action` +
 * encodage d'ID d'action opaque non devinable) — aucune action requise ici,
 * voir SECURITY-AUDIT.md.
 *
 * Pour les Route Handlers (app/api/**\/route.ts) exposés en POST/PUT/PATCH/
 * DELETE, on applique une vérification Origin/Referer classique : l'en-tête
 * Origin (ou à défaut Referer) doit correspondre à l'origine de l'app. Les
 * navigateurs modernes envoient toujours Origin sur les requêtes mutantes
 * cross-site ; un attaquant ne peut pas le falsifier depuis une page web.
 *
 * Exemptions nécessaires (requêtes légitimement hors-origine) :
 *  - Webhooks de prestataires tiers (Paddle/LemonSqueezy, CMI callback) :
 *    aucune notion d'Origin navigateur, protégés par signature HMAC/hash
 *    vérifiée dans la route elle-même.
 *  - NextAuth (/api/auth/*) : gère son propre CSRF (cookie double-submit).
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Préfixes exemptés de la vérification Origin/Referer (voir doc ci-dessus). */
const CSRF_EXEMPT_PREFIXES = [
  '/api/auth', // NextAuth : CSRF géré nativement (cookie double-submit)
  '/api/payments/paddle/webhook', // signature HMAC prestataire
  '/api/payments/cmi/callback', // hash storeKey prestataire
];

function isExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Retourne true si la requête doit être bloquée (mutation cross-origin
 * suspecte). Utilisé par le middleware avant d'atteindre la route.
 */
export function isCsrfSuspicious(request: {
  method: string;
  nextUrl: { pathname: string; origin: string };
  headers: Headers;
}): boolean {
  if (!MUTATING_METHODS.has(request.method)) return false;
  if (isExemptPath(request.nextUrl.pathname)) return false;

  const appOrigin = request.nextUrl.origin;
  const origin = request.headers.get('origin');
  if (origin) return origin !== appOrigin;

  // Pas d'Origin (certains clients non-navigateur/anciens) : repli sur Referer.
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin !== appOrigin;
    } catch {
      return true; // Referer illisible : suspect par défaut.
    }
  }

  // Ni Origin ni Referer sur une mutation : autorisé (clients API via
  // ApiKey/Bearer — cf. requireApiUser qui exige de toute façon une session
  // ou une clé valide ; ce n'est pas un vecteur CSRF puisqu'un navigateur
  // sur une page tierce ne peut pas fabriquer ce header lui-même mais peut
  // omettre Origin dans de rares cas legacy — on ne bloque donc pas ici,
  // l'authentification applicative reste la ligne de défense principale).
  return false;
}
