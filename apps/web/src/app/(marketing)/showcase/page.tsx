import type { Metadata } from 'next';
import { Sparkles, Star, GraduationCap } from 'lucide-react';
import { connectDb, Course, Testimonial } from '@sallycourse/db';
import type { Difficulty } from '@sallycourse/shared';
import { CourseThumbnail } from '@/components/dashboard/course-thumbnail';
import { Badge, Card, CardContent } from '@/components/ui';

/**
 * Vitrine publique (Prompt 89) : cours dont l'auteur a explicitement activé
 * Course.showcaseOptIn. Aucune donnée privée exposée (email, plan, statut
 * interne) — seulement titre, difficulté et éventuel témoignage. Page 100 %
 * publique, pas d'authentification requise.
 */

export const metadata: Metadata = {
  title: 'Vitrine — SallyCourse',
  description: 'Découvrez des cours créés avec SallyCourse par notre communauté de formateurs.',
};

export const dynamic = 'force-dynamic';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

interface ShowcaseEntry {
  id: string;
  title: string;
  difficulty: Difficulty;
  testimonial: { quote: string; rating?: number } | null;
}

async function loadShowcaseEntries(): Promise<ShowcaseEntry[]> {
  await connectDb();

  const courses = await Course.find({ showcaseOptIn: true, status: 'published' })
    .select('_id title difficulty')
    .sort({ updatedAt: -1 })
    .limit(60)
    .lean();

  const courseIds = courses.map((c) => c._id);
  const testimonials = await Testimonial.find({ courseId: { $in: courseIds } })
    .select('courseId quote rating')
    .lean();

  const byCourseId = new Map(testimonials.map((t) => [String(t.courseId), t]));

  return courses.map((c) => {
    const t = byCourseId.get(String(c._id));
    return {
      id: String(c._id),
      title: c.title as string,
      difficulty: c.difficulty as Difficulty,
      testimonial: t ? { quote: t.quote as string, rating: t.rating as number | undefined } : null,
    };
  });
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

export default async function ShowcasePage() {
  const entries = await loadShowcaseEntries();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
      <header className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-accent">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Vitrine de la communauté
        </span>
        <h1 className="mt-5 font-display text-4xl font-semibold text-foreground sm:text-5xl">
          Des cours créés avec SallyCourse
        </h1>
        <p className="mt-4 text-base text-muted">
          Une sélection de cours publiés par des formateurs qui ont choisi de partager leur création.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="mx-auto mt-16 max-w-md text-center">
          <p className="text-sm text-muted">
            Aucun cours n&apos;est encore affiché ici. Publiez le vôtre et activez l&apos;option « Afficher sur
            la vitrine » pour apparaître parmi les premiers.
          </p>
        </div>
      ) : (
        <section className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <Card key={entry.id} wrapperClassName="h-full" className="flex h-full flex-col p-0">
              <div className="relative aspect-video w-full overflow-hidden rounded-t-[calc(1rem-1px)]">
                <CourseThumbnail title={entry.title} />
                <div className="absolute end-2.5 top-2.5 flex items-center gap-1.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-neutral-950/70 text-neutral-100 backdrop-blur-sm">
                    <GraduationCap className="size-3.5" aria-hidden="true" />
                  </span>
                </div>
              </div>
              <CardContent className="flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-center gap-2">
                  <Badge variant="published">{DIFFICULTY_LABELS[entry.difficulty]}</Badge>
                </div>
                <h2 className="line-clamp-2 font-display text-lg font-semibold leading-snug text-foreground">
                  {entry.title}
                </h2>
                {entry.testimonial && (
                  <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3.5">
                    {typeof entry.testimonial.rating === 'number' && (
                      <StarRating rating={entry.testimonial.rating} />
                    )}
                    <p className="text-sm italic text-muted">« {entry.testimonial.quote} »</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
