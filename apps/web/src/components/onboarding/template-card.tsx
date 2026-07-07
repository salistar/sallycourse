'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import {
  COURSE_TONE_LABELS,
  TEMPLATE_CATEGORY_LABELS,
  lessonMixPercentages,
  type CourseTemplate,
} from '@sallycourse/shared';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';
import { transitions } from '@/components/motion';

/**
 * Carte d'un template de niche — sélectionnable (role=radio dans un
 * radiogroup). Emoji d'illustration, accroche, et aperçu de la structure
 * (sections + répartition des types de leçons en %). Aucun hex inline.
 */

const DIFFICULTY_LABELS: Record<CourseTemplate['difficulty'], string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Avancé',
};

/** Barre de répartition des types de leçons (100 % tokens). */
function LessonMixBar({ template }: { template: CourseTemplate }) {
  const pct = lessonMixPercentages(template.lessonMix);
  const segments: Array<{ key: string; label: string; value: number; className: string }> = [
    { key: 'video', label: 'Vidéo', value: pct.video, className: 'bg-primary-500' },
    { key: 'article', label: 'Article', value: pct.article, className: 'bg-primary-300' },
    { key: 'tp', label: 'TP', value: pct.tp, className: 'bg-accent-400' },
    { key: 'quiz', label: 'Quiz', value: pct.quiz, className: 'bg-accent-300' },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-subtle">
        {segments.map((s) => (
          <span
            key={s.key}
            className={cn('h-full', s.className)}
            style={{ width: `${s.value}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted">
        {segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn('inline-block size-2 rounded-full', s.className)} aria-hidden="true" />
            {s.label} {s.value}%
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface TemplateCardProps {
  template: CourseTemplate;
  selected: boolean;
  onSelect: (template: CourseTemplate) => void;
}

export function TemplateCard({ template, selected, onSelect }: TemplateCardProps) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(template)}
      whileHover={{ y: -3 }}
      transition={transitions.springSoft}
      className={cn(
        'group relative flex h-full flex-col gap-4 rounded-lg border p-5 text-start',
        'transition-colors duration-fast ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        selected
          ? 'border-primary bg-primary-soft shadow-glow'
          : 'border-border bg-surface hover:border-ring/50',
      )}
    >
      {/* Coche de sélection */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute end-4 top-4 flex size-6 items-center justify-center rounded-full border transition-all',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-transparent text-transparent',
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>

      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none" aria-hidden="true">
          {template.emoji}
        </span>
        <div className="min-w-0">
          <Badge variant="draft" hideDot className="mb-1">
            {TEMPLATE_CATEGORY_LABELS[template.category]}
          </Badge>
          <h3 className="truncate font-display text-lg font-semibold text-foreground">
            {template.name}
          </h3>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted">{template.tagline}</p>

      <LessonMixBar template={template} />

      <dl className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
        <div className="inline-flex items-center gap-1">
          <dt className="font-semibold text-foreground/70">{template.sections}</dt>
          <dd>sections</dd>
        </div>
        <div className="inline-flex items-center gap-1">
          <dt className="sr-only">Niveau</dt>
          <dd>{DIFFICULTY_LABELS[template.difficulty]}</dd>
        </div>
        <div className="inline-flex items-center gap-1">
          <dt className="sr-only">Ton</dt>
          <dd>Ton {COURSE_TONE_LABELS[template.tone].toLowerCase()}</dd>
        </div>
      </dl>
    </motion.button>
  );
}
