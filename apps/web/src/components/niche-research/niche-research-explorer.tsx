'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Compass, Flame, Sparkles, Wand2 } from 'lucide-react';
import {
  TEMPLATE_CATEGORY_LABELS,
  templateCategorySchema,
  type TemplateCategory,
} from '@sallycourse/shared';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Select, Skeleton, useToast } from '@/components/ui';
import { transitions } from '@/components/motion';
import { findNicheOpportunitiesAction } from '@/app/actions/niche-research';
import type { NicheCandidate } from '@/lib/niche-research';

/**
 * Explorateur « Trouver un sujet » (P86) — formulaire catégorie → liste de
 * candidats scorés demande/concurrence, avec action « Créer un cours » qui
 * pré-remplit /dashboard/new via ?title=.
 */

const CATEGORY_OPTIONS = templateCategorySchema.options;

/** Couleur de badge selon le niveau d'opportunité (demande - concurrence). */
function opportunityVariant(candidate: NicheCandidate): 'ready' | 'generating' | 'draft' {
  const opportunity = candidate.demandScore - candidate.competitionScore;
  if (opportunity >= 25) return 'ready';
  if (opportunity >= 0) return 'generating';
  return 'draft';
}

function opportunityLabel(candidate: NicheCandidate): string {
  const opportunity = candidate.demandScore - candidate.competitionScore;
  if (opportunity >= 25) return 'Opportunité forte';
  if (opportunity >= 0) return 'Opportunité correcte';
  return 'Marché saturé';
}

interface CandidateCardProps {
  candidate: NicheCandidate;
  onCreate: (title: string) => void;
  creating: boolean;
}

function CandidateCard({ candidate, onCreate, creating }: CandidateCardProps) {
  return (
    <Card interactive>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-snug">{candidate.title}</CardTitle>
          <Badge variant={opportunityVariant(candidate)} hideDot className="shrink-0">
            {opportunityLabel(candidate)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">Demande</dt>
            <dd className="font-display text-lg font-semibold text-foreground">{candidate.demandScore}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">Concurrence</dt>
            <dd className="font-display text-lg font-semibold text-foreground">{candidate.competitionScore}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">Cours existants</dt>
            <dd className="font-semibold text-foreground">{candidate.estimatedCourseCount}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">Prix moyen</dt>
            <dd className="font-semibold text-foreground">{candidate.avgPrice} €</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
            <span
              className="h-full bg-gradient-to-r from-primary-500 to-accent-400"
              style={{ width: `${candidate.demandScore}%` }}
              aria-hidden="true"
            />
          </div>
          <p className="text-2xs text-muted">Note moyenne {candidate.avgRating.toFixed(1)}/5</p>
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => onCreate(candidate.title)}
          disabled={creating}
        >
          <Wand2 aria-hidden="true" className="size-3.5" />
          Créer un cours
        </Button>
      </CardContent>
    </Card>
  );
}

export function NicheResearchExplorer() {
  const router = useRouter();
  const { toast } = useToast();
  const [category, setCategory] = React.useState<TemplateCategory>(CATEGORY_OPTIONS[0]);
  const [candidates, setCandidates] = React.useState<NicheCandidate[]>([]);
  const [liveSignal, setLiveSignal] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [creatingTitle, setCreatingTitle] = React.useState<string | null>(null);
  const [hasSearched, setHasSearched] = React.useState(false);

  const runSearch = React.useCallback(
    async (cat: TemplateCategory) => {
      setLoading(true);
      try {
        const response = await findNicheOpportunitiesAction(cat);
        if (!response.ok) {
          toast({ variant: 'danger', title: 'Recherche indisponible', description: response.error });
          return;
        }
        setCandidates(response.result.candidates);
        setLiveSignal(response.result.liveSignal);
        setHasSearched(true);
      } catch {
        toast({
          variant: 'danger',
          title: 'Recherche indisponible',
          description: 'Une erreur est survenue — réessayez dans un instant.',
        });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const handleCreate = (title: string) => {
    setCreatingTitle(title);
    const params = new URLSearchParams({ title });
    router.push(`/dashboard/new?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-8">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitions.enter}
        className="flex flex-col gap-2"
      >
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-2xs font-semibold uppercase tracking-widest text-muted">
          <Compass className="size-3.5 text-accent-400" aria-hidden="true" />
          Recherche de niche
        </span>
        <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
          Trouver un sujet qui a de la demande
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          Choisissez une catégorie : on croise des tendances connues avec un signal de popularité
          best-effort pour estimer la demande et la concurrence de chaque sujet.
        </p>
      </motion.header>

      <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-end">
        <Select
          label="Catégorie"
          value={category}
          onChange={(e) => setCategory(e.target.value as TemplateCategory)}
          wrapperClassName="w-full sm:max-w-xs"
        >
          {CATEGORY_OPTIONS.map((cat) => (
            <option key={cat} value={cat}>
              {TEMPLATE_CATEGORY_LABELS[cat]}
            </option>
          ))}
        </Select>
        <Button onClick={() => runSearch(category)} loading={loading} className="w-full sm:w-auto">
          {!loading && <Sparkles aria-hidden="true" className="size-4" />}
          {loading ? 'Recherche…' : 'Trouver un sujet'}
        </Button>
      </div>

      {liveSignal && hasSearched && (
        <p className="inline-flex w-fit items-center gap-1.5 text-2xs text-muted">
          <Flame className="size-3.5 text-accent-400" aria-hidden="true" />
          Signal de popularité externe enrichi (best-effort).
        </p>
      )}

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && hasSearched && candidates.length === 0 && (
        <p className="text-sm text-muted">Aucun candidat trouvé pour cette catégorie.</p>
      )}

      {!loading && candidates.length > 0 && (
        <div
          className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2')}
          role="list"
          aria-label="Sujets suggérés"
        >
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.title}
              candidate={candidate}
              onCreate={handleCreate}
              creating={creatingTitle === candidate.title}
            />
          ))}
        </div>
      )}
    </div>
  );
}
