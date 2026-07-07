import { NextResponse } from 'next/server';
import { getConfig } from '@sallycourse/shared';
import { connectDb, User as UserModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getCmiConfig, prepareCmiCheckout } from '@/lib/payments/cmi';
import { isPaidPlan } from '@/lib/payments/plans';

/**
 * POST /api/payments/cmi/checkout — initie un paiement CMI (Maroc, MAD).
 * Corps : { plan: 'pro' | 'business' }. Retourne l'action et les champs signés
 * du formulaire 3-D Secure ; le client rend un <form POST auto-soumis>.
 * Si les clés CMI sont absentes → 503 (utiliser /api/payments/mock/activate en dev).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
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

  const cmi = getCmiConfig();
  if (!cmi) {
    return NextResponse.json(
      { error: 'Paiement CMI non configuré. En développement, utilisez le paiement simulé.' },
      { status: 503 },
    );
  }

  await connectDb();
  const dbUser = await UserModel.findById(user.id).select('email name').lean();
  if (!dbUser) {
    return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 404 });
  }

  const appUrl = getConfig().APP_URL.replace(/\/$/, '');
  const prepared = prepareCmiCheckout({
    cfg: cmi,
    userId: user.id,
    plan,
    email: dbUser.email,
    okUrl: `${appUrl}/dashboard/settings?payment=success`,
    failUrl: `${appUrl}/dashboard/settings?payment=failed`,
    callbackUrl: `${appUrl}/api/payments/cmi/callback`,
    lang: user.locale ?? 'fr',
  });

  if (!prepared) {
    return NextResponse.json({ error: 'Tarif indisponible pour ce plan.' }, { status: 400 });
  }

  return NextResponse.json(
    { action: prepared.action, fields: prepared.fields, oid: prepared.oid },
    { status: 200 },
  );
}
