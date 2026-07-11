import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { EmptyState } from '@/components/ui';
import { rankVariants, type VariantRow } from './ab-testing';

/**
 * Section « A/B testing des landing pages » (P87) — présentation pure
 * (Server Component). Affiche les variantes de titre testées sur une
 * plateforme, classées par taux de conversion (enrollments/impressions
 * estimé), avec un badge distinguant la variante actuellement active.
 */

const percentFmt = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 });
const numberFmt = new Intl.NumberFormat('fr-FR');

export function AbTestingPanel({
  platform,
  platformLabel,
  variants,
}: {
  platform: string;
  platformLabel: string;
  variants: VariantRow[];
}) {
  if (variants.length === 0) return null;

  const ranked = rankVariants(variants);
  const best = ranked[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test A/B — titres de landing ({platformLabel})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {ranked.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Pas encore de variantes testées"
              description="Les variantes apparaîtront après la première rotation hebdomadaire."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-6 py-3 font-medium">Titre</th>
                  <th className="px-6 py-3 font-medium">Statut</th>
                  <th className="px-6 py-3 text-right font-medium">Impressions</th>
                  <th className="px-6 py-3 text-right font-medium">Conversions</th>
                  <th className="px-6 py-3 text-right font-medium">Taux</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((v) => (
                  <tr key={`${platform}-${v.variantIndex}`} className="border-b border-border last:border-0">
                    <td className="px-6 py-3 text-foreground">{v.title}</td>
                    <td className="px-6 py-3">
                      {v.isActive ? (
                        <Badge variant="published">Active</Badge>
                      ) : (
                        <Badge variant="draft">Historique</Badge>
                      )}
                      {best && v.variantIndex === best.variantIndex && v.impressions > 0 ? (
                        <Badge variant="published" className="ml-2">
                          Meilleure
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {numberFmt.format(v.impressions)}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {numberFmt.format(v.conversions)}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {v.impressions > 0 ? percentFmt.format(v.rate) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
