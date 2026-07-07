// Registre des providers analytics (Prompt 61) — un provider par plateforme.
// L'agrégation pure et le mock déterministe vivent dans ./aggregate.

import { udemyAnalyticsProvider } from './udemy.js';
import { youtubeAnalyticsProvider } from './youtube.js';
import type { AnalyticsPlatform, AnalyticsProvider } from './types.js';

export * from './types.js';
export * from './aggregate.js';

/** Providers indexés par nom de plateforme. */
const PROVIDERS: Record<AnalyticsPlatform, AnalyticsProvider> = {
  udemy: udemyAnalyticsProvider,
  youtube: youtubeAnalyticsProvider,
};

/** Retourne le provider d'une plateforme, ou undefined si non suivie. */
export function getAnalyticsProvider(platform: string): AnalyticsProvider | undefined {
  return PROVIDERS[platform as AnalyticsPlatform];
}

/** Liste des plateformes disposant d'un provider analytics. */
export function analyticsPlatforms(): AnalyticsPlatform[] {
  return Object.keys(PROVIDERS) as AnalyticsPlatform[];
}
