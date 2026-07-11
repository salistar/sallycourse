/**
 * En-têtes de sécurité HTTP appliqués à TOUTES les réponses par le
 * middleware (P76 — audit sécurité). Un seul point de vérité : toute
 * évolution de la CSP se fait ici, jamais dans next.config.
 */

/**
 * Content-Security-Policy pensé pour Next.js 15 (App Router) + next-intl.
 *
 * - 'unsafe-inline' sur script-src : Next injecte des scripts inline pour
 *   l'hydratation (RSC payload) sans nonce simple à câbler ici (middleware
 *   Edge, pas de nonce par requête branché dans app/layout). C'est un
 *   compromis documenté (voir SECURITY-AUDIT.md) — 'unsafe-eval' n'est PAS
 *   inclus, limitant l'exécution de chaînes arbitraires.
 * - connect-src inclut l'origine elle-même (fetch API interne) + ws/wss
 *   pour le HMR en dev.
 * - img-src autorise data: (icônes inline / placeholders) et blob: (aperçus
 *   médias générés côté client) + https: (miniatures plateformes tierces).
 */
function buildCsp(): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...(isDev ? ['ws:', 'wss:'] : [])],
    'media-src': ["'self'", 'blob:', 'https:'],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

/**
 * Applique l'ensemble des en-têtes de sécurité à une Headers existante
 * (mutation en place, retourne la même instance pour chaînage).
 */
export function applySecurityHeaders(headers: Headers): Headers {
  headers.set('Content-Security-Policy', buildCsp());
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Permissions-Policy',
    [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  );
  // HSTS : seulement pertinent derrière TLS (prod). Sans effet en HTTP dev.
  if (process.env.NODE_ENV === 'production') {
    headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return headers;
}

/** Liste des en-têtes posés — utile pour les tests unitaires. */
export const SECURITY_HEADER_NAMES = [
  'Content-Security-Policy',
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
] as const;
