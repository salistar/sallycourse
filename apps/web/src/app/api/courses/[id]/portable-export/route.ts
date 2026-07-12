import { NextResponse } from 'next/server';
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
 * Nom du fichier ZIP du mode portable (Prompt 142) — produit par le worker
 * (processors/packaging.ts, mode='portable' → PORTABLE_PACK_FILENAME). Dupliqué
 * ici comme pour package/route.ts : source unique de la clé via storageKeys.
 */
const PORTABLE_PACK_FILENAME = 'course-portable.zip';

/** Résout la clé S3 du pack portable d'un cours. */
function portableKey(courseId: string): string {
  return storageKeys.course(courseId).exportFile(PORTABLE_PACK_FILENAME);
}

/**
 * POST /api/courses/[id]/portable-export — enfile un job 'packaging' en mode
 * 'portable' (jobId distinct du pack ZIP standard : les deux modes peuvent
 * être lancés indépendamment sans se piétiner).
 */
export async function POST(
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

  const courseId = id;
  try {
    const queue = getPackagingQueue();
    const jobId = makeJobId(courseId, QUEUES.packaging, 'portable');
    // Un run précédent garderait le jobId réservé : purge avant re-add.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('course-portable', { courseId, mode: 'portable' }, { ...defaultJobOptions, jobId });
  } catch {
    return NextResponse.json(
      { error: "Impossible de lancer l'export portable, réessayez plus tard." },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, status: 'queued' }, { status: 202 });
}

/**
 * GET /api/courses/[id]/portable-export — renvoie une URL présignée si le ZIP
 * portable existe, sinon 404. Même contrat que package/route.ts (GET).
 */
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

  const key = portableKey(id);
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
