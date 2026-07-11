import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';
import { applySecurityHeaders } from '@/lib/security-headers';
import { isCsrfSuspicious } from '@/lib/csrf';

/**
 * Middleware de protection : /dashboard/* et /api/* exigent une session,
 * sauf les routes publiques (/api/auth/*, /api/health). Instancié depuis
 * la config edge-safe (pas de Mongoose ici). Applique aussi (P76) les
 * en-têtes de sécurité à TOUTE réponse et bloque les mutations API dont
 * l'Origin/Referer ne correspond pas à l'app (CSRF sur routes classiques).
 */
const { auth } = NextAuth(authConfig);

const PUBLIC_API_PREFIXES = ['/api/auth', '/api/health'];

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

export default auth((request) => {
  const { pathname, search } = request.nextUrl;

  if (isCsrfSuspicious(request)) {
    return secured(
      NextResponse.json({ error: 'Origine de la requête invalide.' }, { status: 403 }),
    );
  }

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
  // vérifie aussi le rôle admin côté serveur).
  matcher: ['/dashboard/:path*', '/admin/:path*', '/api/:path*'],
};
