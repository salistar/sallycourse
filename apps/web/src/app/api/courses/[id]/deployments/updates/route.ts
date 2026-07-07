import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { detectLessonUpdates, type DeployedLessonSnapshot } from '@sallycourse/shared';
import {
  Course as CourseModel,
  Deployment,
  Lesson as LessonModel,
  connectDb,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/courses/[id]/deployments/updates (P46) — pour chaque plateforme déjà
 * déployée (instantané deployedVersions non vide), calcule les leçons dont le
 * contenu a changé depuis le dernier déploiement (nouvelles ou modifiées). La
 * détection réutilise la logique partagée @sallycourse/shared (même empreinte
 * que le worker) : ce que l'UI affiche == ce que le worker re-uploadera. Alimente
 * le bouton « Mettre à jour les plateformes » sur la page cours.
 */

export const dynamic = 'force-dynamic';

/** Instantané déployé (Mongo) → forme structurelle du détecteur. */
function toSnapshot(raw: unknown): DeployedLessonSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => {
    const e = (v ?? {}) as { lessonId?: unknown; contentHash?: unknown; version?: unknown };
    return {
      lessonId: String(e.lessonId ?? ''),
      contentHash: String(e.contentHash ?? ''),
      version: typeof e.version === 'number' ? e.version : 1,
    };
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const [lessons, deployments] = await Promise.all([
    LessonModel.find({ courseId: id }).sort({ order: 1 }).lean(),
    Deployment.find({ courseId: id }).sort({ updatedAt: -1 }).lean(),
  ]);

  // Une seule projection des leçons (indépendante de la plateforme).
  const lessonInputs = lessons.map((l) => ({
    _id: String(l._id),
    title: l.title,
    type: l.type,
    status: l.status,
    contentHash: l.contentHash,
    assets: {
      videoUrl: l.assets?.videoUrl,
      articleMd: l.assets?.articleMd,
      srtUrl: l.assets?.srtUrl,
      vttUrl: l.assets?.vttUrl,
      audioUrl: l.assets?.audioUrl,
      slides: l.assets?.slides,
    },
  }));

  const platforms = deployments
    .map((d) => {
      const snapshot = toSnapshot((d as { deployedVersions?: unknown }).deployedVersions);
      // Sans instantané, la plateforme n'est pas « déployée » → pas de mise à jour.
      if (snapshot.length === 0) return null;
      const plan = detectLessonUpdates(lessonInputs, snapshot);
      return {
        platform: d.platform,
        status: d.status,
        deployedCount: snapshot.length,
        updates: plan.updates.map((u) => ({
          lessonId: u.lessonId,
          index: u.index,
          title: u.title,
          kind: u.kind,
        })),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return NextResponse.json({ courseId: id, total: lessons.length, platforms });
}
