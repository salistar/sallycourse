// Provider analytics Udemy (Prompt 61) — lecture via l'Instructor API.
//
// En MOCK (MOCK_PROVIDERS ou credentials absents) : métriques déterministes.
// Sinon : appel `fetch` à l'Instructor API pour lire inscrits/note/revenu, avec
// repli sur le mock en cas d'erreur réseau (l'analytics ne doit jamais bloquer).

import { getConfig } from '../../shared.js';
import { mockMetrics } from './aggregate.js';
import type { AnalyticsFetchContext, AnalyticsProvider, PlatformMetrics } from './types.js';

const UDEMY_API_BASE = 'https://www.udemy.com/instructor-api/v1';

/** Vrai si l'on doit servir des données MOCK (pas d'appel réseau réel). */
function useMock(externalId: string | undefined): boolean {
  const cfg = getConfig();
  // Sans credentials Instructor API configurés ni identifiant plateforme, ou en
  // mode MOCK explicite, on renvoie des métriques fictives déterministes.
  return cfg.MOCK_PROVIDERS || !externalId || !process.env.UDEMY_INSTRUCTOR_TOKEN;
}

export const udemyAnalyticsProvider: AnalyticsProvider = {
  platform: 'udemy',
  async fetchMetrics(ctx: AnalyticsFetchContext): Promise<PlatformMetrics> {
    if (useMock(ctx.externalId)) return mockMetrics('udemy', ctx.courseId);

    try {
      const token = process.env.UDEMY_INSTRUCTOR_TOKEN as string;
      const res = await fetch(
        `${UDEMY_API_BASE}/courses/${ctx.externalId}/reviews/?page_size=1&fields[course]=avg_rating,num_subscribers`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      );
      if (!res.ok) return mockMetrics('udemy', ctx.courseId);
      const body = (await res.json()) as {
        avg_rating?: number;
        num_subscribers?: number;
        revenue?: number;
      };
      return {
        platform: 'udemy',
        enrollments: Math.max(0, Math.round(body.num_subscribers ?? 0)),
        rating: Math.min(5, Math.max(0, body.avg_rating ?? 0)),
        revenue: Math.max(0, body.revenue ?? 0),
        views: 0,
      };
    } catch {
      // Réseau/API indisponible : repli mock (déterministe) plutôt qu'échec.
      return mockMetrics('udemy', ctx.courseId);
    }
  },
};
