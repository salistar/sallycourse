import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Clock,
  Gauge,
  Layers,
  Mic,
  Rocket,
  Sparkles,
  Star,
  Wand2,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { connectDb, Course, Testimonial } from '@sallycourse/db';
import { PLANS } from '@sallycourse/shared';
import { buttonVariants, Card, CardContent } from '@/components/ui';
import { StaggerList, StaggerItem } from '@/components/motion';
import { Accordion } from '@/components/marketing/accordion';
import { DemoGeneratorForm } from '@/components/marketing/demo-generator-form';
import { cn } from '@/lib/cn';

/**
 * Landing page marketing (Prompt 95) — page d'accueil publique.
 * Remplace le placeholder qui vivait à apps/web/src/app/page.tsx : la page
 * racine est désormais servie depuis le groupe (marketing), habillée par
 * (marketing)/layout.tsx (en-tête + pied de page publics).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing.hero');
  const title = 'SallyCourse — Créez un cours en ligne complet en quelques minutes';
  const description = t('subtitle');

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'SallyCourse',
      images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'SallyCourse' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og-image.png'],
    },
  };
}

const FEATURE_ICONS = [Wand2, Mic, Rocket, Layers, Check, Gauge] as const;

interface TestimonialEntry {
  quote: string;
  author: string;
  rating?: number;
}

/** Charge jusqu'à 3 témoignages réels (P89) ; retombe sur le contenu i18n si vide. */
async function loadTestimonials(): Promise<TestimonialEntry[]> {
  try {
    await connectDb();
    const testimonials = await Testimonial.find({ rating: { $gte: 4 } })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('quote rating courseId')
      .lean();

    if (testimonials.length === 0) return [];

    const courseIds = testimonials.map((t) => t.courseId);
    const courses = await Course.find({ _id: { $in: courseIds } }).select('_id title').lean();
    const titleByCourseId = new Map(courses.map((c) => [String(c._id), c.title as string]));

    return testimonials.map((t) => ({
      quote: t.quote as string,
      rating: t.rating as number | undefined,
      author: titleByCourseId.get(String(t.courseId)) ?? 'Formateur SallyCourse',
    }));
  } catch {
    // Base indisponible en build/preview statique : retombe sur le contenu i18n.
    return [];
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Note ${rating} sur 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={i < rating ? 'size-3.5 fill-accent text-accent' : 'size-3.5 text-border'}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export default async function HomePage() {
  const [hero, comparison, features, pricingPreview, testimonialsT, faq] = await Promise.all([
    getTranslations('marketing.hero'),
    getTranslations('marketing.comparison'),
    getTranslations('marketing.features'),
    getTranslations('marketing.pricingPreview'),
    getTranslations('marketing.testimonials'),
    getTranslations('marketing.faq'),
  ]);

  const featureItems = features.raw('items') as { title: string; description: string }[];
  const beforeItems = comparison.raw('before') as string[];
  const afterItems = comparison.raw('after') as string[];
  const faqItems = faq.raw('items') as { question: string; answer: string }[];
  const fallbackTestimonials = testimonialsT.raw('empty') as TestimonialEntry[];

  const realTestimonials = await loadTestimonials();
  const testimonials = realTestimonials.length > 0 ? realTestimonials : fallbackTestimonials;

  return (
    <main className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 pb-20 pt-20 sm:pb-28 sm:pt-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,theme(colors.primary.500/25%),transparent)]"
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-accent">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {hero('badge')}
          </span>
          <h1 className="mt-6 font-display text-4xl font-semibold leading-tight text-foreground sm:text-6xl">
            {hero('title')}
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg">{hero('subtitle')}</p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/register" className={cn(buttonVariants({ variant: 'gold', size: 'lg' }), 'gap-2')}>
              {hero('ctaPrimary')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link href="/showcase" className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}>
              {hero('ctaSecondary')}
            </Link>
          </div>

          <p className="mt-6 text-xs text-muted">{hero('trust')}</p>

          <div className="mt-10 flex w-full flex-col items-center border-t border-border/60 pt-8">
            <p className="text-sm font-semibold text-foreground">
              Ou testez tout de suite, sans compte — saisissez un titre :
            </p>
            <DemoGeneratorForm />
          </div>
        </div>
      </section>

      {/* Comparatif avant/après */}
      <section className="border-t border-border/60 bg-surface/30 px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
              {comparison('title')}
            </h2>
            <p className="mt-4 text-base text-muted">{comparison('subtitle')}</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Card className="p-0">
              <CardContent className="flex flex-col gap-4 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold uppercase tracking-wide text-muted">
                    {comparison('beforeLabel')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-2xs font-semibold text-muted">
                    <Clock className="size-3.5" aria-hidden="true" />
                    {comparison('beforeTime')}
                  </span>
                </div>
                <ul className="flex flex-col gap-3">
                  {beforeItems.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card interactive wrapperClassName="md:-translate-y-1" className="p-0 ring-1 ring-accent/20">
              <CardContent className="flex flex-col gap-4 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold uppercase tracking-wide text-accent">
                    {comparison('afterLabel')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent/15 px-2.5 py-0.5 text-2xs font-semibold text-accent">
                    <Clock className="size-3.5" aria-hidden="true" />
                    {comparison('afterTime')}
                  </span>
                </div>
                <ul className="flex flex-col gap-3">
                  {afterItems.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Fonctionnalités clés */}
      <section id="fonctionnalites" className="scroll-mt-20 px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
              {features('title')}
            </h2>
            <p className="mt-4 text-base text-muted">{features('subtitle')}</p>
          </div>

          <StaggerList className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featureItems.map((item, index) => {
              const Icon = FEATURE_ICONS[index % FEATURE_ICONS.length] ?? Sparkles;
              return (
                <StaggerItem key={item.title}>
                  <Card interactive className="h-full p-0">
                    <CardContent className="flex h-full flex-col gap-3 p-6">
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-soft text-primary">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <h3 className="font-display text-lg font-semibold text-foreground">{item.title}</h3>
                      <p className="text-sm leading-relaxed text-muted">{item.description}</p>
                    </CardContent>
                  </Card>
                </StaggerItem>
              );
            })}
          </StaggerList>
        </div>
      </section>

      {/* Aperçu tarifs */}
      <section className="border-t border-border/60 bg-surface/30 px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
            {pricingPreview('title')}
          </h2>
          <p className="mt-4 text-base text-muted">{pricingPreview('subtitle')}</p>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {(Object.keys(PLANS) as (keyof typeof PLANS)[]).map((planId) => {
              const plan = PLANS[planId];
              const featured = planId === 'pro';
              return (
                <Card
                  key={planId}
                  interactive
                  wrapperClassName={cn(featured && 'md:-translate-y-2')}
                  className={cn('flex h-full flex-col p-6', featured && 'ring-1 ring-accent/30')}
                >
                  <h3 className="font-display text-xl font-semibold capitalize text-foreground">{planId}</h3>
                  <p className="mt-2 text-sm text-muted">
                    {Number.isFinite(plan.coursesPerMonth)
                      ? `${plan.coursesPerMonth} cours / mois`
                      : 'Cours illimités'}
                  </p>
                </Card>
              );
            })}
          </div>

          <Link href="/pricing" className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'mt-10 gap-2')}>
            {pricingPreview('cta')}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* Témoignages */}
      <section className="px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
              {testimonialsT('title')}
            </h2>
            <p className="mt-4 text-base text-muted">{testimonialsT('subtitle')}</p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t) => (
              <Card key={t.quote} className="h-full p-0">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  {typeof t.rating === 'number' && <StarRating rating={t.rating} />}
                  <p className="flex-1 text-sm italic leading-relaxed text-foreground">« {t.quote} »</p>
                  <p className="text-xs font-semibold text-muted">{t.author}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border/60 bg-surface/30 px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <h2 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{faq('title')}</h2>
            <p className="mt-4 text-base text-muted">{faq('subtitle')}</p>
          </div>

          <Accordion items={faqItems} className="mt-10" />
        </div>
      </section>

      {/* CTA final */}
      <section className="px-6 py-20 sm:py-28">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-lg border border-accent/30 bg-gradient-to-br from-primary-500/10 via-surface to-accent-400/10 p-10 text-center sm:p-14">
          <h2 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{hero('title')}</h2>
          <Link href="/register" className={cn(buttonVariants({ variant: 'gold', size: 'lg' }), 'gap-2')}>
            {hero('ctaPrimary')}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}
