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
import { getPackagingQueue } from '@/lib/queues';

/**
 * Nom du fichier ZIP produit par le worker (processors/packaging.ts →
 * COURSE_PACK_FILENAME). Dupliqué ici car défini côté worker : source unique
 * de la clé via storageKeys.course(id).exportFile(...).
 */
const COURSE_PACK_FILENAME = 'course-pack.zip';

/** Résout la clé S3 du pack export d'un cours. */
function packKey(courseId: string): string {
  return storageKeys.course(courseId).exportFile(COURSE_PACK_FILENAME);
}

/**
 * POST /api/courses/[id]/package — enfile un job 'packaging' (déduplication
 * BullMQ par jobId : re-poster ne crée pas de doublon). 404 volontaire (et non
 * 403) pour ne pas révéler les cours des autres utilisateurs.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const courseId = id;
  try {
    const queue = getPackagingQueue();
    const jobId = makeJobId(courseId, QUEUES.packaging);
    // Un run précédent garderait le jobId réservé : purge avant re-add.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('course-pack', { courseId }, { ...defaultJobOptions, jobId });
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer le packaging, réessayez plus tard.', code: 'packagingLaunchFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, status: 'queued' }, { status: 202 });
}

/**
 * GET /api/courses/[id]/package — renvoie une URL présignée si le ZIP existe,
 * sinon 404. Permet au bouton client de basculer en lien de téléchargement.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const key = packKey(id);
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
