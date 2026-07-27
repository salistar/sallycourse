import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Store, Tag } from 'lucide-react';
import { connectDb, Course as CourseModel, CourseMarketplaceListing } from '@sallycourse/db';
import { marketplacePriceLabel } from '@sallycourse/shared';
import { Badge, Card, CardContent, EmptyState } from '@/components/ui';
import { BuyListingButton } from '@/components/marketplace/buy-listing-button';

/**
 * /marketplace — catalogue public des cours listés à la vente entre
 * utilisateurs (Prompt 147). Server Component, aucune authentification requise
 * pour parcourir. Filtrable par catégorie via ?category=.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing.marketplace');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

const LICENSE_LABELS: Record<string, string> = {
  'course-copy': 'licenseCourseCopy',
  'template-only': 'licenseTemplateOnly',
};

export default async function MarketplaceCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  await connectDb();
  const t = await getTranslations('marketing.marketplace');
  const { category } = await searchParams;

  const filter: Record<string, unknown> = { status: 'active' };
  if (category) filter.category = category;

  const listings = await CourseMarketplaceListing.find(filter)
    .sort({ publishedAt: -1 })
    .limit(60)
    .lean();

  const courseIds = listings.map((l) => l.courseId);
  const courses = await CourseModel.find({ _id: { $in: courseIds } })
    .select('title difficulty')
    .lean();
  const courseById = new Map(courses.map((c) => [String(c._id), c]));

  const categories = [...new Set(listings.map((l) => l.category).filter(Boolean))] as string[];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-16 sm:py-20">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl text-muted">{t('intro')}</p>
      </header>

      {categories.length > 0 && (
        <nav aria-label={t('categoriesLabel')} className="flex flex-wrap gap-2">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-fast hover:border-ring/50 hover:text-foreground"
          >
            {t('allCategories')}
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              href={`/marketplace?category=${encodeURIComponent(c)}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-fast hover:border-ring/50 hover:text-foreground"
            >
              <Tag className="size-3.5" aria-hidden="true" />
              {c}
            </Link>
          ))}
        </nav>
      )}

      {listings.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      ) : (
        <ul className="grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => {
            const course = courseById.get(String(listing.courseId));
            return (
              <li key={String(listing._id)}>
                <Card interactive className="flex h-full flex-col">
                  <CardContent className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={listing.licenseType === 'course-copy' ? 'ready' : 'published'}>
                        {LICENSE_LABELS[listing.licenseType] ? t(LICENSE_LABELS[listing.licenseType]) : listing.licenseType}
                      </Badge>
                      <span className="text-sm font-semibold text-foreground">
                        {marketplacePriceLabel(listing.priceCents, listing.currency)}
                      </span>
                    </div>
                    <h2 className="font-display text-lg font-semibold text-foreground">
                      {course?.title ?? t('courseFallback')}
                    </h2>
                    {listing.description && (
                      <p className="line-clamp-3 text-sm text-muted">{listing.description}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between pt-2 text-2xs text-muted">
                      <span className="flex items-center gap-1">
                        <Store className="size-3.5" aria-hidden="true" />
                        {t('sales', { count: listing.salesCount })}
                      </span>
                      {listing.category && <span>{listing.category}</span>}
                    </div>
                    <BuyListingButton
                      listingId={String(listing._id)}
                      priceLabel={marketplacePriceLabel(listing.priceCents, listing.currency)}
                    />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
