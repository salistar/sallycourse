import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BookOpen, Clock3, Route } from 'lucide-react';
import { connectDb, LearningPath, LmsListing } from '@sallycourse/db';
import { presignedGetUrl } from '@sallycourse/shared';
import { bundleSavings } from '@sallycourse/shared/learning-path';
import { marketplacePriceLabel } from '@sallycourse/shared/marketplace';
import { Badge, Card, CardContent, EmptyState } from '@/components/ui';

/**
 * /learn — catalogue public du LMS interne. Server Component : lit les
 * LmsListing publiés, présigne les couvertures et affiche une grille de cartes
 * cliquables. Les PARCOURS publiés (P199) sont mis en tête du catalogue : sans
 * cela, un parcours resterait invisible pour l'apprenant qui arrive ici.
 * Aucune authentification requise pour parcourir.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('paths');
  return {
    title: t('list.metaTitle'),
    description: t('list.metaDescription'),
  };
}

// Couvertures présignées à durée de vie courte : pas de cache statique.
export const dynamic = 'force-dynamic';

/** Présigne une clé S3 (couverture) ; échec S3 → carte sans image. */
async function safeCover(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key)) return key;
  try {
    return await presignedGetUrl(key);
  } catch {
    return undefined;
  }
}

/** Formate un prix en centimes vers un libellé (« Gratuit » si 0). */
function priceLabel(cents: number, currency: string, freeLabel: string): string {
  if (!cents || cents <= 0) return freeLabel;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

export default async function LearnCataloguePage() {
  await connectDb();
  const t = await getTranslations('paths');

  const [listings, paths] = await Promise.all([
    LmsListing.find({ published: true }).sort({ publishedAt: -1 }).limit(60).lean(),
    LearningPath.find({ published: true }).sort({ publishedAt: -1 }).limit(12).lean(),
  ]);

  const priceByCourse = new Map(
    listings.map((l) => [String(l.courseId), l.priceCents ?? 0] as const),
  );

  // Cartes parcours : prix bundle + économie face à l'achat des cours un par un.
  const pathCards = paths.map((p) => {
    const savings = bundleSavings(
      p.courses.map((c) => priceByCourse.get(String(c.courseId)) ?? 0),
      p.priceCents,
    );
    return {
      slug: p.slug,
      title: p.title,
      description: p.description,
      courseCount: p.courses.length,
      price: marketplacePriceLabel(p.priceCents, p.currency),
      savings:
        savings.savingsCents > 0
          ? t('savings', { amount: marketplacePriceLabel(savings.savingsCents, p.currency) })
          : null,
    };
  });

  const cards = await Promise.all(
    listings.map(async (l) => ({
      id: String(l.courseId),
      title: l.title,
      summary: l.summary,
      cover: await safeCover(l.coverImageKey),
      lessonCount: l.lessonCount,
      durationMin: l.durationMin,
      price: priceLabel(l.priceCents ?? 0, l.currency ?? 'MAD', t('list.free')),
    })),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('list.title')}</h1>
        <p className="max-w-2xl text-muted">{t('list.intro')}</p>
      </header>

      {pathCards.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
              <Route className="size-5 text-accent" aria-hidden="true" />
              {t('catalogTitle')}
            </h2>
            <p className="text-sm text-muted">{t('catalogSubtitle')}</p>
          </div>

          <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {pathCards.map((p) => (
              <li key={p.slug}>
                <Link href={`/paths/${p.slug}`} className="block h-full focus-visible:outline-none">
                  <Card interactive className="h-full">
                    <CardContent className="flex h-full flex-col gap-2 p-5">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="ready">{t('courseCount', { count: p.courseCount })}</Badge>
                        <Badge variant={p.price === 'Gratuit' ? 'published' : 'ready'}>
                          {p.price}
                        </Badge>
                      </div>
                      <h3 className="font-display text-lg font-semibold text-foreground">
                        {p.title}
                      </h3>
                      {p.description && (
                        <p className="line-clamp-2 text-sm text-muted">{p.description}</p>
                      )}
                      {p.savings && (
                        <p className="mt-auto pt-2 text-xs font-medium text-success">{p.savings}</p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cards.length === 0 ? (
        <EmptyState
          title={t('list.emptyTitle')}
          description={t('list.emptyDescription')}
        />
      ) : (
        <ul className="grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <li key={c.id}>
              <Link href={`/learn/${c.id}`} className="block h-full focus-visible:outline-none">
                <Card interactive className="flex h-full flex-col">
                  <div className="relative aspect-video w-full overflow-hidden rounded-t-[calc(1rem-1px)] bg-surface-subtle">
                    {c.cover ? (
                      <img src={c.cover} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted">
                        <BookOpen className="size-10" aria-hidden="true" />
                      </div>
                    )}
                    <div className="absolute end-2 top-2">
                      <Badge variant={c.price === t('list.free') ? 'published' : 'ready'}>{c.price}</Badge>
                    </div>
                  </div>
                  <CardContent className="flex flex-1 flex-col gap-2 p-5">
                    <h2 className="font-display text-lg font-semibold text-foreground">{c.title}</h2>
                    {c.summary && <p className="line-clamp-2 text-sm text-muted">{c.summary}</p>}
                    <div className="mt-auto flex items-center gap-4 pt-2 text-2xs text-muted">
                      <span className="flex items-center gap-1">
                        <BookOpen className="size-3.5" aria-hidden="true" />
                        {t('list.lessonCount', { count: c.lessonCount })}
                      </span>
                      {c.durationMin > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock3 className="size-3.5" aria-hidden="true" />
                          {t('list.durationMin', { minutes: c.durationMin })}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
