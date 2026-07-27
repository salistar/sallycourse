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
import { rateLimit } from '@/lib/rate-limit';

/**
 * Archive « maître » anti-lock-in (Prompt 182) — même mécanique que
 * package/route.ts (POST enqueue → GET présigné) mais en mode 'archive' : ZIP
 * documenté et RE-IMPORTABLE contenant toutes les sources JSON (course/sections/
 * lessons AVEC script/quizzes) + tous les médias sous media/. Ownership → 404.
 */

/**
 * Nom du fichier ZIP produit par le worker (media/master-archive.ts →
 * MASTER_ARCHIVE_FILENAME). Dupliqué ici car défini côté worker ; la clé reste
 * dérivée de storageKeys.course(id).exportFile(...) (source unique de la clé).
 */
const MASTER_ARCHIVE_FILENAME = 'course-master-archive.zip';

/** Résout la clé S3 de l'archive maître d'un cours. */
function archiveKey(courseId: string): string {
  return storageKeys.course(courseId).exportFile(MASTER_ARCHIVE_FILENAME);
}

/**
 * POST /api/courses/[id]/master-archive — enfile un job 'packaging' en mode
 * 'archive' (déduplication BullMQ par jobId). Rate-limité (action lourde :
 * empaquetage de tous les médias). 404 volontaire si le cours n'appartient pas
 * à l'utilisateur.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  const limited = await rateLimit(`master-archive:user:${user.id}`, { limit: 10, windowSec: 300 }).catch(
    () => ({ allowed: true }) as { allowed: boolean },
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Trop de demandes d’archive, réessayez dans quelques minutes.', code: 'tooManyArchiveRequests' },
      { status: 429 },
    );
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const courseId = id;
  try {
    const queue = getPackagingQueue();
    const jobId = makeJobId(courseId, QUEUES.packaging, 'archive');
    // Un run précédent garderait le jobId réservé : purge avant re-add.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('course-master-archive', { courseId, mode: 'archive' }, { ...defaultJobOptions, jobId });
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer l’archivage, réessayez plus tard.', code: 'archivingLaunchFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, status: 'queued' }, { status: 202 });
}

/**
 * GET /api/courses/[id]/master-archive — renvoie l'URL présignée si l'archive
 * existe, sinon 404 { ready: false }. Même contrat que package/route.ts (GET).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const key = archiveKey(id);
  try {
    if (!(await objectExists(key))) {
      return NextResponse.json({ ready: false }, { status: 404 });
    }
    const url = await presignedGetUrl(key);
    return NextResponse.json({ ready: true, url }, { status: 200 });
  } catch {
    return NextResponse.json({ ready: false }, { status: 404 });
  }
}
