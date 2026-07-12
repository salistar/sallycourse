import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Clock3 } from 'lucide-react';
import { connectDb, LmsListing } from '@sallycourse/db';
import { presignedGetUrl } from '@sallycourse/shared';
import { Badge, Card, CardContent, EmptyState } from '@/components/ui';
import { resolveWhiteLabelSite } from '@/lib/white-label.server';

/**
 * /school/[subdomain] — catalogue white-label (Prompt 143) : réutilise
 * exactement la présentation du catalogue LMS interne (/learn) mais filtré
 * sur les cours publiés par le SEUL propriétaire du sous-domaine (ownerId).
 * Aucune authentification requise — vitrine publique du client Business.
 */

export const dynamic = 'force-dynamic';

async function safeCover(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key)) return key;
  try {
    return await presignedGetUrl(key);
  } catch {
    return undefined;
  }
}

function priceLabel(cents: number, currency: string): string {
  if (!cents || cents <= 0) return 'Gratuit';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

export default async function SchoolCataloguePage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  const site = await resolveWhiteLabelSite(subdomain);
  if (!site) notFound();

  await connectDb();
  const listings = await LmsListing.find({ published: true, userId: site.ownerId })
    .sort({ publishedAt: -1 })
    .limit(60)
    .lean();

  const cards = await Promise.all(
    listings.map(async (l) => ({
      id: String(l.courseId),
      title: l.title,
      summary: l.summary,
      cover: await safeCover(l.coverImageKey),
      lessonCount: l.lessonCount,
      durationMin: l.durationMin,
      price: priceLabel(l.priceCents ?? 0, l.currency ?? 'MAD'),
    })),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Catalogue des cours — {site.schoolName}
        </h1>
        <p className="max-w-2xl text-muted">
          Cours complets — vidéos, articles et quiz — proposés par {site.schoolName}.
        </p>
      </header>

      {cards.length === 0 ? (
        <EmptyState
          title="Aucun cours publié pour le moment"
          description="Les cours publiés par cette école apparaîtront ici."
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
                      <Badge variant={c.price === 'Gratuit' ? 'published' : 'ready'}>{c.price}</Badge>
                    </div>
                  </div>
                  <CardContent className="flex flex-1 flex-col gap-2 p-5">
                    <h2 className="font-display text-lg font-semibold text-foreground">{c.title}</h2>
                    {c.summary && <p className="line-clamp-2 text-sm text-muted">{c.summary}</p>}
                    <div className="mt-auto flex items-center gap-4 pt-2 text-2xs text-muted">
                      <span className="flex items-center gap-1">
                        <BookOpen className="size-3.5" aria-hidden="true" />
                        {c.lessonCount} leçon(s)
                      </span>
                      {c.durationMin > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock3 className="size-3.5" aria-hidden="true" />
                          {c.durationMin} min
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
