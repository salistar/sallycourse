import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Course as CourseModel,
  CourseAnalytics as CourseAnalyticsModel,
  LandingVariant as LandingVariantModel,
} from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { EmptyState } from '@/components/ui';
import {
  aggregateAnalytics,
  PLATFORM_LABELS,
  type PlatformRow,
  type VariantRow,
} from '@/components/analytics';
import { AnalyticsDashboard, AbTestingPanel } from '@/components/analytics';

/**
 * Dashboard analytics consolidé d'un cours (P61) — Server Component :
 * garde d'auth + ownership, lecture des instantanés CourseAnalytics (alimentés
 * par le worker), agrégation multi-plateformes, puis rendu des cartes et des
 * graphiques (SVG/CSS, sans lib de charts).
 */

// Données personnelles + snapshots rafraîchis en tâche de fond : jamais de cache.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Analytics du cours — SallyCourse',
};

export default async function CourseAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();

  const { id } = await params;
  if (!isValidObjectId(id)) notFound();

  await connectDb();

  // Ownership : 404 (et non 403) pour ne pas révéler les cours des autres.
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).lean();
  if (!course) notFound();

  const snapshots = await CourseAnalyticsModel.find({ courseId: course._id })
    .sort({ platform: 1 })
    .lean();

  const rows: PlatformRow[] = snapshots.map((s) => ({
    platform: s.platform,
    label: PLATFORM_LABELS[s.platform] ?? s.platform,
    enrollments: s.enrollments,
    rating: s.rating,
    revenue: s.revenue,
    views: s.views,
    fetchedAt: s.fetchedAt ? new Date(s.fetchedAt).toISOString() : null,
  }));

  const totals = aggregateAnalytics(rows);

  // Test A/B des landing pages (P87) : variantes de titre par plateforme,
  // regroupées pour l'affichage (une section par plateforme testée).
  const variantDocs = await LandingVariantModel.find({ courseId: course._id })
    .sort({ platform: 1, variantIndex: 1 })
    .lean();
  const variantsByPlatform = new Map<string, VariantRow[]>();
  for (const v of variantDocs) {
    const list = variantsByPlatform.get(v.platform) ?? [];
    list.push({
      variantIndex: v.variantIndex,
      title: v.title,
      isActive: v.isActive,
      impressions: v.impressions,
      conversions: v.conversions,
      lastActivatedAt: v.lastActivatedAt ? new Date(v.lastActivatedAt).toISOString() : null,
    });
    variantsByPlatform.set(v.platform, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/dashboard/courses/${id}`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← Retour au cours
        </Link>
        <h1 className="font-display text-3xl font-semibold text-foreground">Analytics</h1>
        <p className="text-sm text-muted">{course.title}</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aucune métrique pour l’instant</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="Pas encore de données"
              description="Les métriques apparaîtront ici une fois le cours publié sur une plateforme et le prochain rafraîchissement effectué."
            />
          </CardContent>
        </Card>
      ) : (
        <AnalyticsDashboard rows={rows} totals={totals} />
      )}

      {[...variantsByPlatform.entries()].map(([platform, variants]) => (
        <AbTestingPanel
          key={platform}
          platform={platform}
          platformLabel={PLATFORM_LABELS[platform] ?? platform}
          variants={variants}
        />
      ))}
    </div>
  );
}
