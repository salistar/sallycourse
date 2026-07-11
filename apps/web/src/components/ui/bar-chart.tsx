/**
 * Petit graphique en barres verticales, SVG pur (pas de lib de charts) — P99.
 * Générique : une série de points {label, value}, hauteur relative au max.
 * Réutilisable pour tout graphique mensuel/journalier simple du dashboard
 * (revenus, coûts, usage…). Pattern aligné sur analytics-dashboard.tsx
 * (barres CSS) mais en SVG pour un axe + graduations.
 */

export interface BarChartPoint {
  label: string;
  value: number;
}

export interface BarChartProps {
  points: BarChartPoint[];
  /** Formatteur de valeur pour les tooltips/étiquettes (défaut : nombre brut). */
  formatValue?: (v: number) => string;
  /** Hauteur du graphique en pixels. */
  height?: number;
  /** Couleur des barres (variable CSS ou couleur littérale). */
  color?: string;
  className?: string;
}

export function BarChart({
  points,
  formatValue = (v) => String(v),
  height = 160,
  color = 'rgb(var(--sc-primary))',
  className,
}: BarChartProps) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = Math.max(points.length * 40, 200);
  const barWidth = points.length > 0 ? (width / points.length) * 0.6 : 0;
  const gap = points.length > 0 ? (width / points.length) * 0.4 : 0;

  if (points.length === 0) {
    return (
      <div className={className}>
        <p className="text-sm text-muted">Aucune donnée sur cette période.</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height + 24}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Graphique en barres"
      >
        {/* Ligne de base */}
        <line x1={0} y1={height} x2={width} y2={height} stroke="rgb(var(--sc-border))" strokeWidth={1} />
        {points.map((p, i) => {
          const barHeight = (p.value / max) * (height - 8);
          const x = i * (barWidth + gap) + gap / 2;
          const y = height - barHeight;
          return (
            <g key={`${p.label}-${i}`}>
              <title>{`${p.label} : ${formatValue(p.value)}`}</title>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={3}
                fill={color}
                opacity={p.value === 0 ? 0.15 : 0.85}
              />
              <text
                x={x + barWidth / 2}
                y={height + 16}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted"
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
