import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  QUEUES,
  defaultJobOptions,
  makeJobId,
  objectExists,
  presignedGetUrl,
  storageKeys,
} from '@sallycourse/shared';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getDeploymentQueue } from '@/lib/queues';

/**
 * Rapport de déploiement (P50). GET renvoie l'URL présignée du dernier rapport
 * PDF s'il existe, POST enfile sa (re)génération sur la queue 'deployment'
 * (action 'report' — toutes plateformes agrégées, sans adapter). Le worker
 * archive courses/{id}/exports/deployment-report-{ts}.pdf + un alias stable
 * deployment-report-latest.pdf servi ici (clé déterministe, comme le pack).
 */

// Données par utilisateur : jamais de cache, runtime Node (Mongo + S3).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Nom stable du dernier rapport, défini côté worker
 * (deploy/report.ts → DEPLOYMENT_REPORT_LATEST). Dupliqué ici, clé résolue via
 * storageKeys.course(id).exportFile(...).
 */
const DEPLOYMENT_REPORT_LATEST = 'deployment-report-latest.pdf';

/** Résout la clé S3 du dernier rapport de déploiement d'un cours. */
function reportKey(courseId: string): string {
  return storageKeys.course(courseId).exportFile(DEPLOYMENT_REPORT_LATEST);
}

/** Vérifie l'authentification + l'ownership ; renvoie l'id ou une Response d'erreur. */
async function requireOwnedCourse(
  params: Promise<{ id: string }>,
): Promise<string | Response> {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }
  return id;
}

/**
 * POST /api/courses/[id]/deployments/report — enfile la génération du rapport
 * (déduplication BullMQ par jobId : re-poster ne crée pas de doublon).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owned = await requireOwnedCourse(params);
  if (owned instanceof Response) return owned;
  const courseId = owned;

  try {
    const queue = getDeploymentQueue();
    const jobId = makeJobId(courseId, QUEUES.deployment, 'report');
    // Un run précédent garderait le jobId réservé : purge avant re-add.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'deployment-report',
      { courseId, action: 'report' },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer le rapport, réessayez plus tard.', code: 'reportStartFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, status: 'queued' }, { status: 202 });
}

/**
 * GET /api/courses/[id]/deployments/report — URL présignée si le PDF existe,
 * sinon 404 { ready:false }. Permet au bouton client de basculer en lien.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const owned = await requireOwnedCourse(params);
  if (owned instanceof Response) return owned;
  const courseId = owned;

  const key = reportKey(courseId);
  try {
    if (!(await objectExists(key))) {
      return NextResponse.json({ ready: false }, { status: 404 });
    }
    const url = await presignedGetUrl(key);
    return NextResponse.json({ ready: true, url }, { status: 200 });
  } catch {
    // Stockage indisponible : traité comme « pas encore prêt » côté client.
    return NextResponse.json({ ready: false }, { status: 404 });
  }
}
