import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';
import { applySecurityHeaders } from '@/lib/security-headers';
import { isCsrfSuspicious } from '@/lib/csrf';
import { extractSubdomain } from '@/lib/white-label';

/**
 * Middleware de protection : /dashboard/* et /api/* exigent une session,
 * sauf les routes publiques (/api/auth/*, /api/health). Instancié depuis
 * la config edge-safe (pas de Mongoose ici). Applique aussi (P76) les
 * en-têtes de sécurité à TOUTE réponse et bloque les mutations API dont
 * l'Origin/Referer ne correspond pas à l'app (CSRF sur routes classiques).
 *
 * P143 — Sous-domaines white-label : si le Host porte un sous-domaine
 * (ex. academie-client.sallycourse.com), la requête est réécrite (rewrite,
 * pas redirect — l'URL visible reste le sous-domaine) vers
 * /school/[subdomain]/... AVANT toute vérification d'auth : le catalogue
 * white-label est public, la résolution du branding (existe/n'existe pas)
 * se fait côté page (Mongoose n'est pas disponible dans l'edge middleware).
 */
const { auth } = NextAuth(authConfig);

const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/health',
  '/api/altcha',
  // Endpoints publics par conception : ils DOIVENT être joignables sans session
  // (le middleware les bloquait en 401 avant d'atteindre le handler). Chacun
  // applique sa propre sécurité en interne :
  //  - démo landing : rate-limit + PoW ALTCHA ;
  //  - webhooks/callbacks de paiement : vérification de signature/clé fournisseur.
  '/api/demo',
  '/api/payments/paddle/webhook',
  '/api/payments/cmi/callback',
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Enveloppe toute réponse sortante avec les en-têtes de sécurité. */
function secured(response: NextResponse): NextResponse {
  applySecurityHeaders(response.headers);
  return response;
}

/**
 * Préfixes protégés par authentification. Historiquement portés par le
 * `matcher` (qui ne couvrait que ces routes) — désormais vérifiés
 * explicitement en code car le matcher a été élargi (P143) pour laisser
 * passer aussi les routes publiques et permettre la détection de
 * sous-domaine white-label sur celles-ci.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/admin', '/api'];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Préfixes jamais réécrits même sous un sous-domaine (assets Next, API, favicon...). */
function isRewriteExempt(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/school') ||
    pathname === '/favicon.ico'
  );
}

export default auth((request) => {
  const { pathname, search } = request.nextUrl;

  if (isCsrfSuspicious(request)) {
    return secured(
      NextResponse.json({ error: 'Origine de la requête invalide.' }, { status: 403 }),
    );
  }

  // P143 : sous-domaine white-label détecté → rewrite transparent vers
  // /school/[subdomain], puis on continue le pipeline normal (headers de
  // sécurité) sans exiger d'authentification (catalogue public).
  const subdomain = extractSubdomain(request.headers.get('host'));
  if (subdomain && !isRewriteExempt(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = `/school/${subdomain}${pathname === '/' ? '' : pathname}`;
    return secured(NextResponse.rewrite(url));
  }

  // P143 : le matcher couvre désormais aussi les routes publiques (pour la
  // détection de sous-domaine ci-dessus) — ne pas exiger d'auth en dehors
  // des préfixes historiquement protégés.
  if (!isProtectedRoute(pathname)) return secured(NextResponse.next());

  if (isPublicApi(pathname)) return secured(NextResponse.next());
  if (request.auth?.user) return secured(NextResponse.next());

  // Négociation : les clients HTML sont redirigés, les autres reçoivent du JSON.
  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  if (!wantsHtml || pathname.startsWith('/api')) {
    return secured(NextResponse.json({ error: 'Authentification requise.' }, { status: 401 }));
  }

  const loginUrl = new URL('/login', request.nextUrl.origin);
  loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
  return secured(NextResponse.redirect(loginUrl));
});

export const config = {
  // /admin vit dans le groupe (dashboard) mais son URL n'est pas préfixée :
  // il doit être couvert explicitement (défense en profondeur, la page
  // vérifie aussi le rôle admin côté serveur). P143 : le matcher est élargi
  // à toutes les routes (hors assets statiques Next) pour que la détection
  // de sous-domaine white-label s'applique même sur les pages publiques
  // (/, /learn, /pricing...) — la logique interne reste inchangée pour les
  // hôtes sans sous-domaine (extractSubdomain renvoie null → comportement
  // strictement identique à avant).
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
