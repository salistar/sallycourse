import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import type { AggregatedAnalytics } from './aggregate';
import type { PlatformRow } from './types';

/**
 * Dashboard analytics consolidé (P61) — présentation pure (Server Component).
 * Cartes de totaux + graphiques simples en SVG/CSS (aucune lib de charts) :
 *  - barres CSS du revenu par plateforme ;
 *  - jauge circulaire SVG de la note moyenne.
 */

const numberFmt = new Intl.NumberFormat('fr-FR');
const currencyFmt = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Couleur (variable de thème) attribuée à une plateforme pour les barres. */
function platformColor(platform: string): string {
  switch (platform) {
    case 'udemy':
      return 'var(--color-primary, #6366f1)';
    case 'youtube':
      return 'var(--color-accent, #ef4444)';
    default:
      return 'var(--color-muted, #94a3b8)';
  }
}

/** Carte de KPI : libellé + grande valeur. */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-6">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        <span className="font-display text-3xl font-semibold text-foreground">{value}</span>
      </CardContent>
    </Card>
  );
}

/** Jauge circulaire SVG (0–5) pour la note moyenne. */
function RatingGauge({ rating }: { rating: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, rating / 5));
  const dash = ratio * circumference;

  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28" role="img" aria-label={`Note moyenne ${rating} sur 5`}>
      <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-border, #e2e8f0)" strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="var(--color-primary, #6366f1)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="48" textAnchor="middle" className="fill-foreground" fontSize="20" fontWeight="600">
        {rating.toFixed(1)}
      </text>
      <text x="50" y="64" textAnchor="middle" className="fill-muted" fontSize="9">
        / 5
      </text>
    </svg>
  );
}

export function AnalyticsDashboard({
  rows,
  totals,
}: {
  rows: PlatformRow[];
  totals: AggregatedAnalytics;
}) {
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="flex flex-col gap-6">
      {/* KPIs consolidés */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Inscrits" value={numberFmt.format(totals.totalEnrollments)} />
        <StatCard label="Vues" value={numberFmt.format(totals.totalViews)} />
        <StatCard label="Revenu" value={currencyFmt.format(totals.totalRevenue)} />
        <StatCard label="Plateformes" value={numberFmt.format(totals.platformCount)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Revenu par plateforme — barres CSS */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenu par plateforme</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 p-6 pt-0">
            {rows.map((row) => (
              <div key={row.platform} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{row.label}</span>
                  <span className="text-muted">{currencyFmt.format(row.revenue)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-surface-subtle">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(row.revenue / maxRevenue) * 100}%`,
                      backgroundColor: platformColor(row.platform),
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Note moyenne — jauge SVG */}
        <Card>
          <CardHeader>
            <CardTitle>Note moyenne</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center p-6 pt-0">
            <RatingGauge rating={totals.averageRating} />
          </CardContent>
        </Card>
      </div>

      {/* Détail par plateforme */}
      <Card>
        <CardHeader>
          <CardTitle>Détail par plateforme</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-6 py-3 font-medium">Plateforme</th>
                  <th className="px-6 py-3 text-right font-medium">Inscrits</th>
                  <th className="px-6 py-3 text-right font-medium">Vues</th>
                  <th className="px-6 py-3 text-right font-medium">Note</th>
                  <th className="px-6 py-3 text-right font-medium">Revenu</th>
                  <th className="px-6 py-3 text-right font-medium">Mis à jour</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.platform} className="border-b border-border last:border-0">
                    <td className="px-6 py-3">
                      <Badge variant="draft">{row.label}</Badge>
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {numberFmt.format(row.enrollments)}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {numberFmt.format(row.views)}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {row.rating > 0 ? row.rating.toFixed(1) : '—'}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {currencyFmt.format(row.revenue)}
                    </td>
                    <td className="px-6 py-3 text-right text-muted">
                      {row.fetchedAt
                        ? new Date(row.fetchedAt).toLocaleDateString('fr-FR')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
