// Provider analytics YouTube (Prompt 61) — lecture via la YouTube Analytics API.
//
// En MOCK (MOCK_PROVIDERS ou credentials absents) : métriques déterministes.
// Sinon : appel `fetch` à l'API Analytics pour lire vues/revenu, avec repli sur
// le mock en cas d'erreur (l'analytics ne doit jamais bloquer le dashboard).

import { getConfig } from '../../shared.js';
import { mockMetrics } from './aggregate.js';
import type { AnalyticsFetchContext, AnalyticsProvider, PlatformMetrics } from './types.js';

const YT_ANALYTICS_BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';

function useMock(externalId: string | undefined): boolean {
  const cfg = getConfig();
  return cfg.MOCK_PROVIDERS || !externalId || !process.env.YOUTUBE_ANALYTICS_TOKEN;
}

export const youtubeAnalyticsProvider: AnalyticsProvider = {
  platform: 'youtube',
  async fetchMetrics(ctx: AnalyticsFetchContext): Promise<PlatformMetrics> {
    if (useMock(ctx.externalId)) return mockMetrics('youtube', ctx.courseId);

    try {
      const token = process.env.YOUTUBE_ANALYTICS_TOKEN as string;
      const params = new URLSearchParams({
        ids: 'channel==MINE',
        metrics: 'views,estimatedRevenue,averageViewPercentage',
        filters: `video==${ctx.externalId}`,
        startDate: '2020-01-01',
        endDate: new Date().toISOString().slice(0, 10),
      });
      const res = await fetch(`${YT_ANALYTICS_BASE}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!res.ok) return mockMetrics('youtube', ctx.courseId);
      const body = (await res.json()) as { rows?: number[][] };
      const row = body.rows?.[0] ?? [];
      const [views = 0, revenue = 0, avgPct = 0] = row;
      return {
        platform: 'youtube',
        enrollments: 0,
        // La rétention (avgPct 0–100) sert de proxy de « note » 0–5.
        rating: Math.min(5, Math.max(0, (avgPct / 100) * 5)),
        revenue: Math.max(0, revenue),
        views: Math.max(0, Math.round(views)),
      };
    } catch {
      return mockMetrics('youtube', ctx.courseId);
    }
  },
};
