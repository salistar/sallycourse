import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { z } from 'zod';
import { connectDb, User as UserModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { isValidIce, isValidIf } from '@/lib/payments/moroccan-tax';

/**
 * /api/account/billing — réglages de facturation Maroc (Prompt 148) : statut
 * fiscal (auto-entrepreneur / société), ICE, IF, raison sociale, adresse.
 * Repris tels quels (snapshot) sur chaque Invoice émise ensuite — modifier ces
 * réglages ne change pas rétroactivement les factures déjà émises.
 */

export const dynamic = 'force-dynamic';

const billingInputSchema = z.object({
  billingTaxStatus: z.enum(['auto_entrepreneur', 'company', 'unspecified']),
  billingIce: z.string().trim().max(20).optional().or(z.literal('')),
  billingIf: z.string().trim().max(20).optional().or(z.literal('')),
  billingCompanyName: z.string().trim().max(120).optional().or(z.literal('')),
  billingAddress: z.string().trim().max(300).optional().or(z.literal('')),
});

/** GET — réglages de facturation courants. */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const doc = await UserModel.findById(user.id)
    .select('billingTaxStatus billingIce billingIf billingCompanyName billingAddress')
    .lean();

  return NextResponse.json({
    billing: {
      billingTaxStatus: doc?.billingTaxStatus ?? 'unspecified',
      billingIce: doc?.billingIce ?? '',
      billingIf: doc?.billingIf ?? '',
      billingCompanyName: doc?.billingCompanyName ?? '',
      billingAddress: doc?.billingAddress ?? '',
    },
  });
}

/** PUT — met à jour les réglages de facturation. */
export async function PUT(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = billingInputSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join(' ; ');
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { billingTaxStatus, billingCompanyName, billingAddress } = parsed.data;
  const billingIce = parsed.data.billingIce?.trim() ?? '';
  const billingIf = parsed.data.billingIf?.trim() ?? '';

  // Société marocaine : ICE et IF exigés et validés au format officiel avant
  // enregistrement — évite d'émettre des factures non conformes plus tard.
  if (billingTaxStatus === 'company') {
    if (!billingIce || !isValidIce(billingIce)) {
      return NextResponse.json(
        { error: 'ICE invalide (15 chiffres attendus) — obligatoire pour une société.', code: 'invalidIceCompany' },
        { status: 400 },
      );
    }
    if (!billingIf || !isValidIf(billingIf)) {
      return NextResponse.json(
        { error: 'IF invalide (6 à 8 chiffres attendus) — obligatoire pour une société.', code: 'invalidIfCompany' },
        { status: 400 },
      );
    }
  }
  // Auto-entrepreneur : ICE optionnel mais, si renseigné, doit être valide.
  if (billingTaxStatus === 'auto_entrepreneur' && billingIce && !isValidIce(billingIce)) {
    return NextResponse.json({ error: 'ICE invalide (15 chiffres attendus).', code: 'invalidIce' }, { status: 400 });
  }

  await connectDb();
  await UserModel.updateOne(
    { _id: user.id },
    {
      $set: {
        billingTaxStatus,
        billingIce: billingIce || undefined,
        billingIf: billingIf || undefined,
        billingCompanyName: billingCompanyName?.trim() || undefined,
        billingAddress: billingAddress?.trim() || undefined,
      },
    },
  );

  return NextResponse.json({ ok: true });
}
