import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getConfig } from '@sallycourse/shared';
import { connectDb, User as UserModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { activatePlan, isPaidPlan } from '@/lib/payments/plans';
import { AFFILIATE_COOKIE_NAME, isValidAffiliateCode } from '@/lib/affiliate';
import { logger } from '@/lib/logger';

/**
 * POST /api/payments/mock/activate — simulateur de paiement (DEV UNIQUEMENT).
 * Corps : { plan: 'pro' | 'business' }. Active immédiatement le plan de
 * l'utilisateur connecté, sans passerelle réelle. Bloqué en production et
 * lorsque de vraies clés de paiement sont configurées, pour éviter tout abus.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Le mock n'est autorisé qu'en dev/test et sans passerelle réelle branchée. */
function mockAllowed(): boolean {
  const cfg = getConfig();
  if (cfg.NODE_ENV === 'production') return false;
  const hasRealGateway =
    Boolean(cfg.CMI_MERCHANT_ID && cfg.CMI_STORE_KEY) || Boolean(cfg.PADDLE_API_KEY);
  return !hasRealGateway;
}

export async function POST(request: Request) {
  if (!mockAllowed()) {
    return NextResponse.json({ error: 'Paiement simulé indisponible.' }, { status: 404 });
  }

  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const plan = (body as { plan?: unknown })?.plan;
  if (typeof plan !== 'string' || !isPaidPlan(plan)) {
    return NextResponse.json({ error: 'Plan invalide (pro | business attendu).' }, { status: 400 });
  }

  // Affiliation (P89) : mémorise le code référent en attente s'il n'a pas déjà
  // été capturé par un checkout réel (le mock saute cette étape).
  const refCode = (await cookies()).get(AFFILIATE_COOKIE_NAME)?.value;
  if (refCode && isValidAffiliateCode(refCode)) {
    await connectDb();
    await UserModel.updateOne({ _id: user.id }, { $set: { pendingReferralCode: refCode } });
  }

  const result = await activatePlan({
    userId: user.id,
    plan,
    provider: 'mock',
    providerRef: `mock-${user.id}-${plan}`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  logger.info({ userId: user.id, plan }, '[mock] plan activé (paiement simulé)');
  return NextResponse.json({ ok: true, plan }, { status: 200 });
}
