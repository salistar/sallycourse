'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Compass, Flame, Sparkles, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
// Sous-module direct (et non le barrel @sallycourse/shared) : le barrel
// réexporte crypto.ts (node:crypto), incompatible avec le bundle client.
import {
  TEMPLATE_CATEGORY_LABELS,
  templateCategorySchema,
  type TemplateCategory,
} from '@sallycourse/shared/course-templates';
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

function opportunityLabelKey(candidate: NicheCandidate): string {
  const opportunity = candidate.demandScore - candidate.competitionScore;
  if (opportunity >= 25) return 'opportunity.strong';
  if (opportunity >= 0) return 'opportunity.correct';
  return 'opportunity.saturated';
}

interface CandidateCardProps {
  candidate: NicheCandidate;
  onCreate: (title: string) => void;
  creating: boolean;
}

function CandidateCard({ candidate, onCreate, creating }: CandidateCardProps) {
  const t = useTranslations('nicheResearch');
  return (
    <Card interactive>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-snug">{candidate.title}</CardTitle>
          <Badge variant={opportunityVariant(candidate)} hideDot className="shrink-0">
            {t(opportunityLabelKey(candidate))}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">{t('candidate.demand')}</dt>
            <dd className="font-display text-lg font-semibold text-foreground">{candidate.demandScore}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">{t('candidate.competition')}</dt>
            <dd className="font-display text-lg font-semibold text-foreground">{candidate.competitionScore}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">{t('candidate.existingCourses')}</dt>
            <dd className="font-semibold text-foreground">≈ {candidate.estimatedCourseCount}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-2xs uppercase tracking-wide text-muted">{t('candidate.avgPriceLabel')}</dt>
            <dd className="font-semibold text-foreground">≈ {candidate.avgPrice} €</dd>
          </div>
        </dl>

        {/* Barre = score de demande (0-100), pas une note d'avis réelle. */}
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
          <span
            className="h-full bg-gradient-to-r from-primary-500 to-accent-400"
            style={{ width: `${candidate.demandScore}%` }}
            aria-hidden="true"
          />
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => onCreate(candidate.title)}
          disabled={creating}
        >
          <Wand2 aria-hidden="true" className="size-3.5" />
          {t('candidate.createCourse')}
        </Button>
      </CardContent>
    </Card>
  );
}

export function NicheResearchExplorer() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('nicheResearch');
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
          toast({ variant: 'danger', title: t('toast.searchUnavailableTitle'), description: response.error });
          return;
        }
        setCandidates(response.result.candidates);
        setLiveSignal(response.result.liveSignal);
        setHasSearched(true);
      } catch {
        toast({
          variant: 'danger',
          title: t('toast.searchUnavailableTitle'),
          description: t('toast.genericErrorDescription'),
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
          {t('badge')}
        </span>
        <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
          {t('title')}
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          {t('subtitle')}
        </p>
      </motion.header>

      <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-end">
        <Select
          label={t('categoryLabel')}
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
          {loading ? t('searching') : t('searchButton')}
        </Button>
      </div>

      {liveSignal && hasSearched && (
        <p className="inline-flex w-fit items-center gap-1.5 text-2xs text-muted">
          <Flame className="size-3.5 text-accent-400" aria-hidden="true" />
          {t('liveSignalNote')}
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
        <p className="text-sm text-muted">{t('empty')}</p>
      )}

      {!loading && candidates.length > 0 && (
        <p className="rounded-md border border-border bg-surface-subtle px-3.5 py-2.5 text-2xs text-muted">
          <strong className="font-semibold text-foreground">{t('disclaimerTitle')}</strong>{' '}
          {t('disclaimerBody')}
        </p>
      )}

      {!loading && candidates.length > 0 && (
        <div
          className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2')}
          role="list"
          aria-label={t('suggestedTopicsAriaLabel')}
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
