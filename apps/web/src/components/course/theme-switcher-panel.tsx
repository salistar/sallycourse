'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Palette } from 'lucide-react';
import { THEME_CATALOG, DEFAULT_THEME_ID } from '@sallycourse/shared/theme-catalog';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/error-message';

/**
 * Panneau « Thème du cours » (catalogue 2026-07-26) : pastilles de thèmes,
 * sélection puis « Appliquer » → POST /api/courses/[id]/theme. Le changement
 * re-rend les vidéos du cours (slides au nouveau thème, audio inchangé) ; les
 * articles sont thémés instantanément à l'affichage.
 */
export interface ThemeSwitcherPanelProps {
  courseId: string;
  themeId?: string;
  /** Cours en génération initiale : action neutralisée. */
  disabled?: boolean;
}

export function ThemeSwitcherPanel({ courseId, themeId, disabled = false }: ThemeSwitcherPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.theme');
  const tApiError = useTranslations('apiErrors');
  const current = themeId ?? DEFAULT_THEME_ID;
  const [selected, setSelected] = React.useState(current);
  const [loading, setLoading] = React.useState(false);

  const apply = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/theme`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ themeId: selected }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { rerendering?: number } | null;
        toast({
          title: t('appliedTitle'),
          description: t('appliedDescription', { count: data?.rerendering ?? 0 }),
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
      }
    } catch {
      toast({ title: t('failedTitle'), description: t('networkError'), variant: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette aria-hidden="true" className="size-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {THEME_CATALOG.map((theme) => (
            <button
              key={theme.id}
              type="button"
              disabled={disabled}
              onClick={() => setSelected(theme.id)}
              aria-pressed={selected === theme.id}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                selected === theme.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-surface text-muted hover:border-primary/50',
              )}
            >
              <span className="flex overflow-hidden rounded-full border border-border">
                {theme.swatch.map((hex) => (
                  <span key={hex} className="size-3.5" style={{ backgroundColor: hex }} />
                ))}
              </span>
              {theme.name}
              {theme.id === current && (
                <span className="text-[10px] uppercase tracking-wide text-muted">{t('current')}</span>
              )}
            </button>
          ))}
        </div>
        <div>
          <Button size="sm" onClick={apply} loading={loading} disabled={disabled || selected === current}>
            {t('apply')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
