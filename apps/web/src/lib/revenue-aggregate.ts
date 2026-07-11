import type { FxCurrency } from '@sallycourse/shared';
import { convertAmount } from '@sallycourse/shared';

/**
 * Agrégation revenus consolidée (Prompt 99) — fonctions PURES, testables sans
 * base. Les pages serveur font les requêtes Mongo (CourseAnalytics,
 * Subscription…) puis passent des lignes déjà projetées ici.
 *
 * Sources couvertes :
 * - Udemy / YouTube : CourseAnalytics.revenue (déjà en USD, P61).
 * - Abonnements SaaS (CMI/Paddle) : Subscription actif → prix du plan
 *   (PLAN_PRICING, apps/web/src/lib/payments/plans.ts) en MAD ou EUR.
 * - Gumroad : l'API Gumroad (v2) n'expose PAS le revenu cumulé d'un produit
 *   dans les endpoints utilisés par l'adapter (apps/worker/src/deploy/adapters/gumroad.ts
 *   ne lit que id/short_url/published, pas de champ `sales_usd_cents` fiable
 *   sans scope additionnel). Faute d'un flux fiable, la source Gumroad est
 *   documentée à 0 ici — brancher `GET /products/:id` avec le scope `view_sales`
 *   et le champ `sales_usd_cents` si l'intégration est complétée plus tard.
 */

/** Une ligne de revenu brute, déjà normalisée en devise d'origine. */
export interface RevenueEntry {
  /** Source du revenu. */
  source: 'udemy' | 'youtube' | 'subscription' | 'gumroad';
  /** Date d'attribution du revenu (jour de facturation / dernière mesure). */
  date: Date;
  /** Montant dans sa devise d'origine (unité majeure, ex. 29.90). */
  amount: number;
  currency: FxCurrency;
  /** Identifiant contextuel (courseId ou userId) pour traçabilité/export. */
  refId: string;
}

/** Ligne CourseAnalytics projetée (revenu déjà en USD, P61). */
export interface CourseAnalyticsRevenueRow {
  courseId: string;
  platform: string;
  revenue: number;
  fetchedAt: Date;
}

/** Convertit les lignes CourseAnalytics (Udemy/YouTube) en RevenueEntry (USD). */
export function courseAnalyticsToEntries(rows: CourseAnalyticsRevenueRow[]): RevenueEntry[] {
  return rows
    .filter((r) => r.platform === 'udemy' || r.platform === 'youtube')
    .map((r) => ({
      source: r.platform as 'udemy' | 'youtube',
      date: r.fetchedAt,
      amount: r.revenue,
      currency: 'USD' as const,
      refId: r.courseId,
    }));
}

/** Abonnement actif projeté, avec le prix résolu dans sa devise de facturation. */
export interface SubscriptionRevenueRow {
  userId: string;
  /** Devise de facturation (CMI → MAD, Paddle/Lemon → EUR). */
  currency: FxCurrency;
  /** Montant du plan (unité majeure) déjà résolu depuis PLAN_PRICING. */
  amount: number;
  /** Date à laquelle imputer ce revenu (activation ou début de période). */
  billedAt: Date;
}

/** Convertit les abonnements actifs en RevenueEntry. */
export function subscriptionsToEntries(rows: SubscriptionRevenueRow[]): RevenueEntry[] {
  return rows.map((r) => ({
    source: 'subscription' as const,
    date: r.billedAt,
    amount: r.amount,
    currency: r.currency,
    refId: r.userId,
  }));
}

/**
 * Source Gumroad : aucun flux de revenu fiable exposé par l'adapter actuel
 * (voir doc en tête de fichier). Renvoie toujours un tableau vide — le point
 * d'extension est ici si un futur appel `GET /products/:id?view_sales` est
 * ajouté à l'adapter worker.
 */
export function gumroadToEntries(): RevenueEntry[] {
  return [];
}

/** Un point de série mensuelle, en devise cible unique. */
export interface MonthlyRevenuePoint {
  /** Mois au format YYYY-MM. */
  month: string;
  totalConverted: number;
  bySource: Record<RevenueEntry['source'], number>;
}

/** Clé YYYY-MM (UTC) d'une date. */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const SOURCES: RevenueEntry['source'][] = ['udemy', 'youtube', 'subscription', 'gumroad'];

/**
 * Agrège des entrées multi-sources/multi-devises en série mensuelle, tout
 * converti dans `targetCurrency` (USD par défaut). Mois sans revenu = 0
 * (pas de trou) sur la fenêtre `months` se terminant au mois de `end`.
 */
export function aggregateMonthlyRevenue(
  entries: RevenueEntry[],
  targetCurrency: FxCurrency = 'USD',
  months = 12,
  end: Date = new Date(),
): MonthlyRevenuePoint[] {
  const byMonth = new Map<string, MonthlyRevenuePoint>();

  for (const e of entries) {
    const key = monthKey(e.date);
    const converted = convertAmount(e.amount, e.currency, targetCurrency);
    if (!byMonth.has(key)) {
      byMonth.set(key, {
        month: key,
        totalConverted: 0,
        bySource: { udemy: 0, youtube: 0, subscription: 0, gumroad: 0 },
      });
    }
    const point = byMonth.get(key)!;
    point.totalConverted = Math.round((point.totalConverted + converted) * 100) / 100;
    point.bySource[e.source] = Math.round((point.bySource[e.source] + converted) * 100) / 100;
  }

  // Fenêtre glissante de `months` mois se terminant au mois de `end` (UTC),
  // les mois absents valant 0 — garantit un point par mois pour le graphique.
  const series: MonthlyRevenuePoint[] = [];
  const cursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(cursor);
    d.setUTCMonth(cursor.getUTCMonth() - i);
    const key = monthKey(d);
    series.push(
      byMonth.get(key) ?? {
        month: key,
        totalConverted: 0,
        bySource: { udemy: 0, youtube: 0, subscription: 0, gumroad: 0 },
      },
    );
  }
  return series;
}

/** Total consolidé (devise cible) toutes sources confondues. */
export function totalRevenue(entries: RevenueEntry[], targetCurrency: FxCurrency = 'USD'): number {
  const total = entries.reduce((acc, e) => acc + convertAmount(e.amount, e.currency, targetCurrency), 0);
  return Math.round(total * 100) / 100;
}

/** Total consolidé par source (devise cible). */
export function totalBySource(
  entries: RevenueEntry[],
  targetCurrency: FxCurrency = 'USD',
): Record<RevenueEntry['source'], number> {
  const totals: Record<RevenueEntry['source'], number> = {
    udemy: 0,
    youtube: 0,
    subscription: 0,
    gumroad: 0,
  };
  for (const e of entries) {
    totals[e.source] = Math.round((totals[e.source] + convertAmount(e.amount, e.currency, targetCurrency)) * 100) / 100;
  }
  return totals;
}

/** Échappe une valeur pour une cellule CSV (RFC 4180 minimal : guillemets si virgule/quote/saut de ligne). */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export comptable CSV : une ligne par entrée de revenu — date, source,
 * montant (devise d'origine), devise, montant converti (devise cible).
 * En-têtes en français, format universel (séparateur virgule, point décimal).
 */
export function toAccountingCsv(entries: RevenueEntry[], targetCurrency: FxCurrency = 'USD'): string {
  const header = ['date', 'source', 'montant', 'devise', `montant_converti_${targetCurrency}`].join(',');
  const lines = entries
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((e) => {
      const converted = convertAmount(e.amount, e.currency, targetCurrency);
      return [
        csvCell(e.date.toISOString().slice(0, 10)),
        csvCell(e.source),
        csvCell(e.amount.toFixed(2)),
        csvCell(e.currency),
        csvCell(converted.toFixed(2)),
      ].join(',');
    });
  return [header, ...lines].join('\n');
}

export { SOURCES as REVENUE_SOURCES };
