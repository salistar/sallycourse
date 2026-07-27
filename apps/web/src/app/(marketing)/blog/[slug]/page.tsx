import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react';
import { connectDb, BlogPost as BlogPostModel, Course as CourseModel, User as UserModel } from '@sallycourse/db';
import { jsonLdHtml } from '@/lib/json-ld';
import { blogFaqJsonLd, blogPostingJsonLd } from '@sallycourse/shared/blog';
import { ArticleView } from '@/components/course';
import { Badge, Card, CardContent, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * /blog/[slug] — article de blog SEO public (P204). Server Component : rend le
 * Markdown persisté (corps + maillage interne + CTA cours déjà appendus par le
 * générateur), affiche la FAQ et injecte le JSON-LD schema.org (BlogPosting +
 * FAQPage). Un article encore PROGRAMMÉ est un 404 (invisible avant échéance).
 */

export const dynamic = 'force-dynamic';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** Charge un article PUBLIÉ par son slug (null si inexistant ou pas encore publié). */
async function loadPublishedPost(slug: string) {
  await connectDb();
  return BlogPostModel.findOne({ slug: slug.toLowerCase(), status: 'published' }).lean();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTranslations('blog');
  const post = await loadPublishedPost(slug);
  if (!post) return { title: t('blogPost.metaTitle') };
  return {
    title: `${post.title} — SallyCourse`,
    description: post.metaDescription,
    alternates: { canonical: `${APP_URL.replace(/\/+$/, '')}/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.metaDescription,
      publishedTime: (post.publishedAt ?? post.scheduledFor).toISOString(),
    },
  };
}

export default async function BlogArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const t = await getTranslations('blog');
  const { slug } = await params;

  const post = await loadPublishedPost(slug);
  if (!post) notFound();

  const [course, author] = await Promise.all([
    CourseModel.findById(post.courseId).select('title').lean(),
    UserModel.findById(post.userId).select('name').lean(),
  ]);

  const courseId = String(post.courseId);
  const courseUrl = `/learn/${courseId}`;
  const publishedAt = post.publishedAt ?? post.scheduledFor;

  // JSON-LD : l'article (BlogPosting, rattaché au cours) et sa FAQ (FAQPage).
  const articleLd = blogPostingJsonLd({
    title: post.title,
    metaDescription: post.metaDescription,
    slug: post.slug,
    publishedAt,
    updatedAt: post.updatedAt,
    authorName: author?.name ?? 'SallyCourse',
    siteUrl: APP_URL,
    faq: post.faq,
    courseUrl: `${APP_URL.replace(/\/+$/, '')}${courseUrl}`,
    courseTitle: course?.title ?? post.title,
  });
  const faqLd = blogFaqJsonLd(post.faq);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <script
        type="application/ld+json"
        // Titre/description/FAQ viennent du LLM : jsonLdHtml échappe < > & pour
        // qu'un « </script> » ne referme pas la balise (stored XSS).
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(articleLd) }}
      />
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqLd) }}
        />
      )}

      <Link
        href="/blog"
        className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors duration-fast hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('back')}
      </Link>

      <header className="mb-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="draft">{post.keyword}</Badge>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            <time dateTime={publishedAt.toISOString()}>{publishedAt.toISOString().slice(0, 10)}</time>
          </span>
        </div>
        <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{post.title}</h1>
        <p className="text-lg text-muted">{post.metaDescription}</p>
      </header>

      <ArticleView markdown={post.markdown} className="text-base" />

      {post.faq.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 font-display text-2xl font-semibold text-foreground">{t('faq')}</h2>
          <div className="flex flex-col gap-3">
            {post.faq.map((entry) => (
              <details
                key={entry.question}
                className="rounded-lg border border-border bg-surface p-4 open:shadow-sm"
              >
                <summary className="cursor-pointer text-sm font-medium text-foreground">{entry.question}</summary>
                <p className="mt-2 text-sm text-muted">{entry.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Le CTA vers le cours est déjà DANS le Markdown (appendu à la génération,
          logique pure renderCourseCta) : on ne le redouble pas ici. On expose en
          revanche le cours comme carte finale, après la FAQ, pour l'apprenant qui
          descend jusqu'au bout de la page. */}
      {course && (
        <Card className="mt-12">
          <CardContent className="flex flex-col gap-3 p-6">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('cta.eyebrow')}</span>
            <h2 className="font-display text-xl font-semibold text-foreground">{course.title}</h2>
            <p className="text-sm text-muted">{t('cta.description')}</p>
            <Link href={courseUrl} className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'self-start')}>
              {t('cta.action')}
              <ArrowRight aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
