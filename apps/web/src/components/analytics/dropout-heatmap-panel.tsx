import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { EmptyState } from '@/components/ui';
import type { DropoutHeatmapPoint } from '@/lib/dropout-heatmap';

/**
 * Heatmap d'abandon (Prompt 144) — présentation pure (Server Component).
 * Une barre par leçon (plan de cours, ordre chronologique) colorée du vert
 * (peu d'abandon) au rouge (fort abandon), avec suggestion actionnable sur le
 * pire point de chute.
 */

/** Couleur de la barre selon le taux d'abandon (vert → orange → rouge). */
function dropoutColor(rate: number): string {
  if (rate >= 60) return 'rgb(var(--sc-danger))';
  if (rate >= 40) return 'rgb(var(--sc-warning))';
  return 'rgb(var(--sc-success))';
}

export function DropoutHeatmapPanel({
  points,
  suggestion,
}: {
  points: DropoutHeatmapPoint[];
  suggestion: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Heatmap d’abandon par leçon</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-6 pt-0">
        {points.length === 0 ? (
          <EmptyState
            title="Pas encore de leçons"
            description="La heatmap apparaîtra une fois le cours doté de leçons et d'inscrits."
          />
        ) : (
          <>
            {suggestion && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-surface-subtle p-3 text-sm text-foreground">
                <Badge variant="draft">Suggestion</Badge>
                <span>{suggestion}</span>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {points.map((p) => (
                <div key={p.lessonId} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">
                      {p.label} — {p.title}
                    </span>
                    <span className="text-muted">{p.dropoutRate}% d’abandon</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-surface-subtle">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${p.dropoutRate}%`, backgroundColor: dropoutColor(p.dropoutRate) }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
