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
 * Export SCORM (Prompt 42) — même mécanique que master-archive/route.ts
 * (POST enfile un job packaging mode 'scorm' → GET présigne le ZIP) : produit un
 * paquet SCORM 1.2 (imsmanifest + ressources HTML/vidéo) importable dans un LMS
 * tiers (Moodle, TalentLMS…). Ownership → 404. Rate-limité (action lourde).
 */

/** Nom du ZIP SCORM (worker deploy/scorm.ts → SCORM_ZIP_FILENAME). */
const SCORM_FILENAME = 'scorm.zip';

/** Résout la clé S3 du paquet SCORM d'un cours. */
function scormKey(courseId: string): string {
  return storageKeys.course(courseId).exportFile(SCORM_FILENAME);
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  const limited = await rateLimit(`scorm-export:user:${user.id}`, { limit: 10, windowSec: 300 }).catch(
    () => ({ allowed: true }) as { allowed: boolean },
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Trop de demandes d’export SCORM, réessayez dans quelques minutes.', code: 'tooManyRequests' },
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
    const jobId = makeJobId(courseId, QUEUES.packaging, 'scorm');
    // Un run précédent garderait le jobId réservé : purge avant re-add.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('course-scorm', { courseId, mode: 'scorm' }, { ...defaultJobOptions, jobId });
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer l’export SCORM, réessayez plus tard.', code: 'scormExportFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, status: 'queued' }, { status: 202 });
}

/**
 * GET /api/courses/[id]/scorm-export — renvoie l'URL présignée si le paquet
 * SCORM existe, sinon 404 { ready: false }.
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

  const key = scormKey(id);
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
