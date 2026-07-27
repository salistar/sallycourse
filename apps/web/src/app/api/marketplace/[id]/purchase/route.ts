import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { getConfig } from '@sallycourse/shared';
import { connectDb, CourseMarketplaceListing } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { processMarketplacePurchase, marketplaceCheckoutStub } from '@/lib/marketplace';

/**
 * POST /api/marketplace/[id]/purchase — achète un listing marketplace (P147).
 * Réutilise le STUB de paiement du LMS interne (P43/P54) : gratuit ou mode
 * mock → duplication immédiate ; prix réel sans provider configuré → 402
 * documenté (la vraie intégration CMI/Paddle multi-vendeur est un
 * prolongement direct de /api/payments/cmi/checkout, hors scope ici).
 * Un vendeur ne peut pas acheter son propre listing.
 */

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Listing introuvable.', code: 'listingNotFound' }, { status: 404 });
  }

  await connectDb();

  const listing = await CourseMarketplaceListing.findOne({ _id: id, status: 'active' })
    .select('sellerId priceCents')
    .lean();
  if (!listing) {
    return NextResponse.json({ error: 'Listing introuvable ou retiré.', code: 'listingNotFoundOrRemoved' }, { status: 404 });
  }

  if (String(listing.sellerId) === String(user.id)) {
    return NextResponse.json({ error: 'Vous ne pouvez pas acheter votre propre cours.', code: 'cannotBuyOwnCourse' }, { status: 400 });
  }

  const checkout = marketplaceCheckoutStub(listing.priceCents, getConfig().MOCK_PROVIDERS);
  if (!checkout.granted) {
    return NextResponse.json({ error: checkout.reason }, { status: 402 });
  }

  // providerRef unique par tentative d'achat — l'idempotence protège seulement
  // contre un rejeu du MÊME providerRef (double-clic réseau), pas contre un
  // rachat volontaire (nouvelle copie autorisée).
  const providerRef = `mkt-${id}-${user.id}-${randomUUID()}`;
  const provider = listing.priceCents <= 0 ? 'free' : 'mock';

  const result = await processMarketplacePurchase({
    listingId: id,
    buyerId: user.id!,
    provider,
    providerRef,
  });

  if (!result.ok) {
    const status = result.reason === 'listing_not_found' ? 404 : 409;
    return NextResponse.json({ error: `Achat impossible (${result.reason}).`, code: 'purchaseFailed', params: { reason: result.reason } }, { status });
  }

  return NextResponse.json(
    {
      purchaseId: result.purchaseId,
      deliveredCourseId: result.deliveredCourseId ?? null,
      message: checkout.reason,
    },
    { status: 201 },
  );
}
