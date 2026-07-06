import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';

/**
 * Middleware de protection : /dashboard/* et /api/* exigent une session,
 * sauf les routes publiques (/api/auth/*, /api/health). Instancié depuis
 * la config edge-safe (pas de Mongoose ici).
 */
const { auth } = NextAuth(authConfig);

const PUBLIC_API_PREFIXES = ['/api/auth', '/api/health'];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default auth((request) => {
  const { pathname, search } = request.nextUrl;

  if (isPublicApi(pathname)) return NextResponse.next();
  if (request.auth?.user) return NextResponse.next();

  // Négociation : les clients HTML sont redirigés, les autres reçoivent du JSON.
  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  if (!wantsHtml || pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.nextUrl.origin);
  loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  // /admin vit dans le groupe (dashboard) mais son URL n'est pas préfixée :
  // il doit être couvert explicitement (défense en profondeur, la page
  // vérifie aussi le rôle admin côté serveur).
  matcher: ['/dashboard/:path*', '/admin/:path*', '/api/:path*'],
};
