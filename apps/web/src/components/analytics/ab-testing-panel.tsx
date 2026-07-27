import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { EmptyState } from '@/components/ui';
import { rankVariants, type VariantRow } from './ab-testing';
import { getTranslations, getFormatter } from 'next-intl/server';

/**
 * Section « A/B testing des landing pages » (P87) — présentation pure
 * (Server Component). Affiche les variantes de titre testées sur une
 * plateforme, classées par taux de conversion (enrollments/impressions
 * estimé), avec un badge distinguant la variante actuellement active.
 */

export async function AbTestingPanel({
  platform,
  platformLabel,
  variants,
}: {
  platform: string;
  platformLabel: string;
  variants: VariantRow[];
}) {
  if (variants.length === 0) return null;

  const t = await getTranslations('analytics.abTesting');
  const format = await getFormatter();
  const ranked = rankVariants(variants);
  const best = ranked[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title', { platformLabel })}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {ranked.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-6 py-3 font-medium">{t('columns.title')}</th>
                  <th className="px-6 py-3 font-medium">{t('columns.status')}</th>
                  <th className="px-6 py-3 text-right font-medium">{t('columns.impressions')}</th>
                  <th className="px-6 py-3 text-right font-medium">{t('columns.conversions')}</th>
                  <th className="px-6 py-3 text-right font-medium">{t('columns.rate')}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((v) => (
                  <tr key={`${platform}-${v.variantIndex}`} className="border-b border-border last:border-0">
                    <td className="px-6 py-3 text-foreground">{v.title}</td>
                    <td className="px-6 py-3">
                      {v.isActive ? (
                        <Badge variant="published">{t('status.active')}</Badge>
                      ) : (
                        <Badge variant="draft">{t('status.historical')}</Badge>
                      )}
                      {best && v.variantIndex === best.variantIndex && v.impressions > 0 ? (
                        <Badge variant="published" className="ml-2">
                          {t('status.best')}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {format.number(v.impressions)}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {format.number(v.conversions)}
                    </td>
                    <td className="px-6 py-3 text-right text-foreground">
                      {v.impressions > 0 ? format.number(v.rate, { style: 'percent', maximumFractionDigits: 2 }) : '—'}
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
