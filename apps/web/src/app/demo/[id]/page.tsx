import type { Metadata } from 'next';
import Link from 'next/link';
import { isValidObjectId } from 'mongoose';
import { ArrowRight, Clapperboard, ShieldAlert, Sparkles } from 'lucide-react';
import { connectDb, DemoCourse } from '@sallycourse/db';
import { Card, CardContent, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Page PUBLIQUE d'aperçu de démo (Prompt 96) — /demo/[id]. Aucune
 * authentification requise. Affiche l'aperçu de la première "vidéo" (slides +
 * narration) du mini cours de démo généré depuis la landing, avec un CTA vers
 * l'inscription. Le document DemoCourse expire 24h après création (TTL Mongo
 * natif) : passé ce délai, la page affiche un état "expiré" identique à
 * l'état "introuvable" (pas de fuite d'information sur l'existence passée).
 */

export const dynamic = 'force-dynamic';

interface DemoPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: DemoPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Aperçu de démo — SallyCourse`,
    description: 'Aperçu d’un mini cours généré automatiquement par SallyCourse.',
    robots: { index: false, follow: false },
  };
}

async function loadDemo(id: string) {
  if (!isValidObjectId(id)) return null;
  await connectDb();
  // Pas de filtre expiresAt explicite : le TTL Mongo natif purge le document
  // lui-même ; un id valide mais purgé retombe naturellement sur "introuvable".
  return DemoCourse.findById(id).lean();
}

export default async function DemoPage({ params }: DemoPageProps) {
  const { id } = await params;
  const demo = await loadDemo(id);

  if (!demo) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
        <div className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center gap-3 border-b border-border bg-danger/10 px-6 py-4">
            <ShieldAlert className="size-6 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-danger">Démo introuvable ou expirée</p>
              <p className="text-xs text-muted">Les aperçus de démo sont conservés 24 heures.</p>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-6 py-6">
            <p className="text-sm text-muted">
              Générez un nouvel aperçu depuis la page d’accueil, ou inscrivez-vous pour créer un cours
              complet sans limite de durée.
            </p>
            <Link href="/" className={cn(buttonVariants({ variant: 'gold', size: 'lg' }), 'gap-2 self-start')}>
              Retour à l’accueil
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const firstLesson = demo.section.lessons[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-accent">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Aperçu de démo — généré automatiquement
        </span>
        <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{demo.title}</h1>
        <p className="max-w-xl text-sm text-muted">
          Section « {demo.section.title} » — {demo.section.lessons.length} leçon
          {demo.section.lessons.length > 1 ? 's' : ''} générée
          {demo.section.lessons.length > 1 ? 's' : ''} en quelques secondes.
        </p>
      </div>

      {firstLesson && (
        <Card className="p-0">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Clapperboard className="size-4 text-accent" aria-hidden="true" />
              {firstLesson.title}
              <span className="ml-auto text-xs font-normal text-muted">{firstLesson.durationMin} min</span>
            </div>

            <div className="flex flex-col gap-5">
              {firstLesson.slides.map((slide, i) => (
                <div key={`${slide.heading}-${i}`} className="rounded-md border border-border bg-surface-subtle p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent">Slide {i + 1}</p>
                  <p className="mt-1 text-base font-semibold text-foreground">{slide.heading}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {slide.bullets.map((bullet) => (
                      <li key={bullet} className="text-sm text-muted">
                        • {bullet}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 border-t border-border pt-3 text-sm italic leading-relaxed text-foreground">
                    « {slide.narration} »
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col items-center gap-4 rounded-lg border border-accent/30 bg-gradient-to-br from-primary-500/10 via-surface to-accent-400/10 p-8 text-center">
        <p className="text-base font-semibold text-foreground">
          Ceci n’est qu’un aperçu — le cours complet inclut vidéos narrées, articles, TP et quiz.
        </p>
        <Link href="/register" className={cn(buttonVariants({ variant: 'gold', size: 'lg' }), 'gap-2')}>
          Créez le vôtre — inscrivez-vous
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}
