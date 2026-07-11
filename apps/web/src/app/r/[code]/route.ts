import { NextResponse } from 'next/server';
import { getConfig } from '@sallycourse/shared';
import { isValidAffiliateCode, AFFILIATE_COOKIE_NAME, AFFILIATE_COOKIE_MAX_AGE_SECONDS } from '@/lib/affiliate';
import { recordAffiliateClick } from '@/lib/payments/affiliate-service';
import { logger } from '@/lib/logger';

/**
 * GET /r/[code] — lien d'affiliation partageable (Prompt 89). Redirige vers la
 * page tarifs et pose un cookie de tracking (30 jours) contenant le code. Le
 * webhook d'activation d'abonnement (P54) lit ce cookie pour créditer une
 * commission au référent — voir lib/payments/affiliate-service.ts.
 *
 * Best-effort : un code malformé ou inconnu redirige quand même vers /pricing
 * (jamais d'erreur visible pour un visiteur qui clique un lien de partage).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const appUrl = getConfig().APP_URL;
  const response = NextResponse.redirect(new URL('/pricing', appUrl), { status: 302 });

  if (isValidAffiliateCode(code)) {
    // Enregistrement du clic best-effort — n'affecte jamais la redirection.
    try {
      await recordAffiliateClick(code);
    } catch (err) {
      logger.warn({ err, code }, 'Affiliation : échec de l’enregistrement du clic');
    }

    response.cookies.set(AFFILIATE_COOKIE_NAME, code, {
      httpOnly: true,
      sameSite: 'lax',
      secure: getConfig().NODE_ENV === 'production',
      path: '/',
      maxAge: AFFILIATE_COOKIE_MAX_AGE_SECONDS,
    });
  }

  return response;
}
