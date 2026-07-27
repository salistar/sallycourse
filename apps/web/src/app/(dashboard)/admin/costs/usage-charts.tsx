import type { CostKind } from '@sallycourse/shared';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cn } from '@/lib/cn';
import type { ProviderUsage, UsageDay } from './cost-stats';

/**
 * Graphes d'usage/coût par provider (P — dashboard providers). Composants
 * PRÉSENTATIONNELS purs (server components) : barres en CSS (largeur/hauteur en
 * style inline, autorisé par la CSP style-src 'unsafe-inline'), aucune lib de
 * charts externe (bundle + CSP). Couleurs = tokens du design system.
 */

const USD_FORMAT: Intl.NumberFormatOptions = { style: 'currency', currency: 'USD', maximumFractionDigits: 4 };

/** Couleur + libellé par nature de coût (aligné sur les tokens SALISTAR). */
const KIND_STYLE: Record<CostKind, { bar: string; labelKey: string }> = {
  claude: { bar: 'bg-primary', labelKey: 'kind.claude' },
  tts: { bar: 'bg-accent', labelKey: 'kind.tts' },
  render: { bar: 'bg-warning', labelKey: 'kind.render' },
  image: { bar: 'bg-success', labelKey: 'kind.image' },
  // Whisper + avatar (audit coûts 2026-07-26) — nouvelles natures instrumentées.
  transcribe: { bar: 'bg-info', labelKey: 'kind.transcribe' },
  avatar: { bar: 'bg-danger', labelKey: 'kind.avatar' },
};

const KIND_ORDER: CostKind[] = ['claude', 'tts', 'render', 'image', 'transcribe', 'avatar'];

/** Légende partagée (nature → couleur). */
async function KindLegend() {
  const t = await getTranslations('admin.usageCharts');
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
      {KIND_ORDER.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={cn('inline-block size-2.5 rounded-sm', KIND_STYLE[k].bar)} aria-hidden />
          {t(KIND_STYLE[k].labelKey)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Histogramme temporel : coût quotidien empilé par nature sur la fenêtre
 * fournie (30 j par défaut). Hauteur d'une barre ∝ coût du jour / coût max.
 * Les jours sans activité restent visibles (série continue).
 */
export async function UsageTimelineChart({ days }: { days: readonly UsageDay[] }) {
  const t = await getTranslations('admin.usageCharts');
  const format = await getFormatter();
  const maxUsd = Math.max(...days.map((d) => d.totalUsd), 0.0001);
  const totalUsd = days.reduce((acc, d) => acc + d.totalUsd, 0);
  const totalCalls = days.reduce((acc, d) => acc + d.calls, 0);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{t('costPerDay', { count: days.length })}</p>
          <p className="text-2xs text-muted">
            {format.number(totalUsd, USD_FORMAT)} · {t('callsOverPeriod', { count: totalCalls })}
          </p>
        </div>
        <KindLegend />
      </div>

      {/* Barres : hauteur en % via style inline (CSP style-src 'unsafe-inline'). */}
      <div className="flex h-40 items-end gap-px" role="img" aria-label={t('timelineAriaLabel')}>
        {days.map((day) => {
          const heightPct = day.totalUsd > 0 ? Math.max(2, (day.totalUsd / maxUsd) * 100) : 0;
          const title = `${day.date} — ${format.number(day.totalUsd, USD_FORMAT)} · ${t('callsCount', { count: day.calls })}`;
          return (
            <div key={day.date} className="group relative flex h-full flex-1 items-end" title={title}>
              {day.totalUsd > 0 ? (
                <div className="flex w-full flex-col-reverse" style={{ height: `${heightPct}%` }}>
                  {KIND_ORDER.map((k) => {
                    const part = day.byKind[k];
                    if (part <= 0) return null;
                    const segPct = (part / day.totalUsd) * 100;
                    return (
                      <div
                        key={k}
                        className={cn('w-full first:rounded-t-sm', KIND_STYLE[k].bar)}
                        style={{ height: `${segPct}%` }}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="h-px w-full rounded-sm bg-border" />
              )}
            </div>
          );
        })}
      </div>

      {/* Repères de dates : premier, milieu, dernier. */}
      <div className="flex justify-between text-2xs tabular-nums text-muted">
        <span>{days[0]?.date}</span>
        <span>{days[Math.floor(days.length / 2)]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

/**
 * Barres horizontales par provider : longueur ∝ nombre d'appels (les providers
 * gratuits ont un coût nul mais un usage réel — on classe par usage, coût affiché
 * à côté). Chaque provider est coloré selon sa nature dominante.
 */
export async function ProviderUsageBars({ providers }: { providers: readonly ProviderUsage[] }) {
  const t = await getTranslations('admin.usageCharts');
  const format = await getFormatter();
  const maxCalls = Math.max(...providers.map((p) => p.calls), 1);

  if (providers.length === 0) {
    return <p className="text-2xs text-muted">{t('noCallsYet')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.map((p) => {
        const widthPct = Math.max(3, (p.calls / maxCalls) * 100);
        const isFree = p.totalUsd === 0;
        return (
          <div key={`${p.kind}:${p.provider}`} className="flex items-center gap-3 text-xs">
            <div className="w-40 shrink-0 truncate font-mono text-foreground" title={p.provider}>
              {p.provider}
            </div>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-surface-subtle">
              <div
                className={cn('h-full rounded', KIND_STYLE[p.kind].bar)}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <div className="w-16 shrink-0 text-end tabular-nums text-muted">{format.number(p.calls)}</div>
            <div
              className={cn('w-24 shrink-0 text-end tabular-nums', isFree ? 'text-success' : 'text-foreground')}
            >
              {isFree ? t('free') : format.number(p.totalUsd, USD_FORMAT)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
