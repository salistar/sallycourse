import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react';
import { connectDb, BlogPost as BlogPostModel } from '@sallycourse/db';
import { BLOG } from '@sallycourse/shared/blog';
import { Badge, Card, CardContent, EmptyState, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * /blog — index public et INDEXABLE du blog SEO (P204). Server Component :
 * liste les BlogPost déjà publiés (status='published' : les articles programmés
 * restent invisibles), paginés du plus récent au plus ancien. Aucune
 * authentification requise.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('blog');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

// Le calendrier de publication fait apparaître de nouveaux articles à chaque
// passage horaire du worker : pas de rendu statique figé.
export const dynamic = 'force-dynamic';

interface BlogIndexEntry {
  slug: string;
  title: string;
  metaDescription: string;
  keyword: string;
  publishedAt: Date;
}

/** Page demandée (?page=N), bornée à 1 par défaut. */
function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const t = await getTranslations('blog');
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);

  await connectDb();

  const filter = { status: 'published' as const };
  const total = await BlogPostModel.countDocuments(filter);
  const pageCount = Math.max(1, Math.ceil(total / BLOG.PAGE_SIZE));
  const current = Math.min(page, pageCount);

  const posts = await BlogPostModel.find(filter)
    .select('slug title metaDescription keyword publishedAt')
    .sort({ publishedAt: -1 })
    .skip((current - 1) * BLOG.PAGE_SIZE)
    .limit(BLOG.PAGE_SIZE)
    .lean();

  const entries: BlogIndexEntry[] = posts.map((p) => ({
    slug: p.slug,
    title: p.title,
    metaDescription: p.metaDescription,
    keyword: p.keyword,
    publishedAt: p.publishedAt ?? p.scheduledFor,
  }));

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <header className="mb-10 flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{t('title')}</h1>
        <p className="max-w-2xl text-muted">{t('subtitle')}</p>
      </header>

      {entries.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((entry) => (
            <Card key={entry.slug}>
              <CardContent className="flex flex-col gap-3 p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="draft">{entry.keyword}</Badge>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    <time dateTime={entry.publishedAt.toISOString()}>
                      {entry.publishedAt.toISOString().slice(0, 10)}
                    </time>
                  </span>
                </div>
                <h2 className="font-display text-xl font-semibold text-foreground">
                  <Link href={`/blog/${entry.slug}`} className="transition-colors duration-fast hover:text-primary">
                    {entry.title}
                  </Link>
                </h2>
                <p className="text-sm text-muted">{entry.metaDescription}</p>
                <Link
                  href={`/blog/${entry.slug}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
                >
                  {t('read')}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label={t('pagination.label')} className="mt-10 flex items-center justify-between gap-4">
          {current > 1 ? (
            <Link
              href={current - 1 === 1 ? '/blog' : `/blog?page=${current - 1}`}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              rel="prev"
            >
              <ArrowLeft aria-hidden="true" />
              {t('pagination.previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">{t('pagination.position', { current, total: pageCount })}</span>
          {current < pageCount ? (
            <Link
              href={`/blog?page=${current + 1}`}
              className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              rel="next"
            >
              {t('pagination.next')}
              <ArrowRight aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
