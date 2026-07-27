'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, ExternalLink, Newspaper, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import type { CourseBlogView } from './types';

/**
 * Section « Blog SEO » (P204) : articles générés automatiquement à la
 * publication du cours sur le LMS — statut, date de publication prévue, lien
 * public, et bouton de régénération (POST /api/courses/[id]/blog, qui réenfile
 * le job worker : 1 appel LLM pour le plan + 1 par article).
 */

export interface BlogPanelProps {
  courseId: string;
  blog?: CourseBlogView | null;
}

const STATUS_VARIANT = {
  published: 'published',
  scheduled: 'generating',
  draft: 'draft',
} as const;

const STATUS_LABEL = {
  published: 'statusPublished',
  scheduled: 'statusScheduled',
  draft: 'statusDraft',
} as const;

export function BlogPanel({ courseId, blog }: BlogPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.blog');
  const tApiError = useTranslations('apiErrors');
  const [loading, setLoading] = React.useState(false);

  // Cours pas encore publié sur le LMS : aucun blog possible (le CTA et le
  // JSON-LD pointeraient dans le vide) — section masquée.
  if (!blog?.publishedOnLms) return null;

  const regenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/blog`, { method: 'POST' });
      if (res.ok) {
        toast({
          title: t('generationStartedTitle'),
          description: t('generationStartedDescription'),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('generationFailedTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: t('networkErrorTitle'),
        description: t('networkErrorDescription'),
        variant: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  const published = blog.posts.filter((p) => p.status === 'published').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Newspaper className="size-5 text-accent" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <Button variant="secondary" size="sm" loading={loading} onClick={regenerate}>
          {!loading && <RefreshCw aria-hidden="true" />}
          {t('regenerate')}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {blog.posts.length === 0 ? (
          <p className="text-sm text-muted">
            {t('empty')}
          </p>
        ) : (
          <>
            <p className="text-2xs text-muted">
              {t('publishedCount', { published, total: blog.posts.length })}
            </p>
            <ul className="flex flex-col gap-2">
              {blog.posts.map((post) => (
                <li
                  key={post.slug}
                  className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{post.title}</span>
                      <Badge variant={STATUS_VARIANT[post.status]}>{t(STATUS_LABEL[post.status])}</Badge>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1.5">
                        <CalendarClock className="size-3.5" aria-hidden="true" />
                        {post.status === 'published' && post.publishedAt
                          ? t('publishedOn', { date: post.publishedAt.slice(0, 10) })
                          : t('scheduledFor', { date: post.scheduledFor.slice(0, 10) })}
                      </span>
                      <span>{t('keyword', { keyword: post.keyword })}</span>
                    </span>
                  </span>
                  {post.status === 'published' ? (
                    <Link
                      href={`/blog/${post.slug}`}
                      target="_blank"
                      className="shrink-0 text-muted transition-colors duration-fast hover:text-primary"
                      aria-label={t('openArticle', { title: post.title })}
                    >
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
