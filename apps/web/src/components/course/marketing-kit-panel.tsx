'use client';

import * as React from 'react';
import { Copy, Megaphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, useToast } from '@/components/ui';
import type { MarketingKitView } from './types';

/**
 * Panneau « Kit marketing » (Prompt 28) : rend visibles les sorties marketing
 * générées par le worker (description Udemy SEO, texte promo, messages
 * bienvenue/félicitations, 5 idées de titres scorées) et les visuels (cover
 * Udemy 750×422, miniature YouTube 1280×720, hero SDXL) — jusqu'ici stockés
 * sans aucun affichage. Masqué tant que rien n'a été généré.
 */
export function MarketingKitPanel({ marketing }: { marketing?: MarketingKitView | null }) {
  const { toast } = useToast();
  const t = useTranslations('course.marketing');
  if (!marketing) return null;

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t('copied', { label }), variant: 'success' });
    } catch {
      toast({ title: t('copyFailed'), variant: 'danger' });
    }
  };

  const imageLink = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/50 hover:text-primary"
    >
      {label}
    </a>
  );

  const textBlock = (label: string, text: string) =>
    text ? (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-muted">{label}</span>
          <button
            type="button"
            onClick={() => void copy(label, text)}
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-muted hover:bg-primary-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
          >
            <Copy className="size-3" aria-hidden="true" />
            {t('copy')}
          </button>
        </div>
        <p className="whitespace-pre-wrap rounded-sm border border-border bg-surface-subtle p-2.5 text-xs text-foreground">
          {text}
        </p>
      </div>
    ) : null;

  const images: { url?: string; label: string; note: string }[] = [
    { url: marketing.heroCoverUrl, label: t('heroLabel'), note: t('heroNote') },
    { url: marketing.udemyCoverUrl, label: t('udemyCoverLabel'), note: '750 × 422' },
    { url: marketing.youtubeThumbnailUrl, label: t('youtubeThumbnailLabel'), note: '1280 × 720' },
  ];
  const availableImages = images.filter((i) => i.url);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Megaphone className="size-5 text-accent" aria-hidden="true" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {availableImages.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {availableImages.map((img) => (
              <div key={img.label} className="flex flex-col gap-1.5">
                <img
                  src={img.url}
                  alt={t('imageAlt', { label: img.label })}
                  className="w-full rounded-md border border-border object-cover"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs text-muted">
                    {img.label} · {img.note}
                  </span>
                  {img.url && imageLink(img.url, t('download'))}
                </div>
              </div>
            ))}
          </div>
        )}

        {textBlock(t('udemyDescription'), marketing.udemyDescription)}
        {textBlock(t('promoText'), marketing.promoText)}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {textBlock(t('welcomeMessage'), marketing.welcomeMessage)}
          {textBlock(t('congratsMessage'), marketing.congratsMessage)}
        </div>

        {marketing.titleIdeas.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
              {t('titleIdeas')}
            </span>
            <ul className="flex list-none flex-col gap-1.5 p-0">
              {marketing.titleIdeas
                .slice()
                .sort((a, b) => b.score - a.score)
                .map((idea) => (
                  <li
                    key={idea.title}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-surface p-2.5"
                  >
                    <span className="min-w-0 flex-1 text-xs text-foreground">
                      <strong className="font-semibold">{idea.title}</strong>
                      {idea.reason && <span className="block text-2xs text-muted">{idea.reason}</span>}
                    </span>
                    <span className="shrink-0 font-display text-sm font-semibold text-accent-300 tabular-nums">
                      {t('scoreOutOf', { score: idea.score })}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <p className="text-2xs text-muted">
          {t('autoGeneratedNote')}
        </p>
      </CardContent>
    </Card>
  );
}
