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
import { connectDb, Course as CourseModel, Deployment } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getPackagingQueue } from '@/lib/queues';
import { getCapabilities, isKnownPlatform } from '@/lib/deploy-catalog';

/**
 * Pack « guide manuel » (Prompt 176) : enfile un job packaging en mode
 * 'manual-guide' pour une plateforme donnée (Udemy/Teachable/Thinkific/interne…),
 * puis expose l'URL présignée du ZIP produit. Le nom de fichier dépend de la
 * plateforme (course-manual-guide-{platform}.zip) : les ids de plateforme
 * manuelle sont déjà des slugs sûrs, donc identiques au nom calculé côté worker
 * (manualGuidePackFileName). Ownership → 404 (convention repo).
 */

/**
 * Résout la clé S3 du pack guide manuel d'un cours pour une plateforme. Le guide
 * de REPRISE (P179) porte un suffixe `-resume` (aligné sur manualGuidePackFileName
 * côté worker) pour coexister avec le guide complet (P176).
 */
function guideKey(courseId: string, platform: string, resume = false): string {
  return storageKeys.course(courseId).exportFile(
    `course-manual-guide-${platform}${resume ? '-resume' : ''}.zip`,
  );
}

/**
 * Valide et normalise la plateforme demandée : doit être connue ET éligible au
 * mode manuel (capabilities.modes inclut 'manual'). Repli null si invalide.
 */
function normalizeManualPlatform(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const platform = raw.trim().toLowerCase();
  if (!platform || !isKnownPlatform(platform)) return null;
  return getCapabilities(platform).modes.includes('manual') ? platform : null;
}

/** Vérifie que le cours existe et appartient à l'utilisateur (404 sinon). */
async function ownedCourseId(
  id: string,
  userId: string,
): Promise<string | null> {
  if (!isValidObjectId(id)) return null;
  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId }).select('_id').lean();
  return course ? id : null;
}

/**
 * POST /api/courses/[id]/manual-guide — enfile un job 'packaging' en mode
 * 'manual-guide' pour la plateforme du corps de requête. jobId distinct PAR
 * plateforme : plusieurs guides plateforme peuvent coexister sans se piétiner.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { platform?: unknown; resume?: unknown }
    | null;
  const platform = normalizeManualPlatform(body?.platform);
  if (!platform) {
    return apiError('invalidManualPlatform');
  }
  const resume = body?.resume === true;

  const courseId = await ownedCourseId(id, user.id);
  if (!courseId) {
    return apiError('courseNotFound');
  }

  // Guide de REPRISE (P179) : lit le checkpoint préservé du déploiement de la
  // plateforme (leçons déjà uploadées / étape atteinte) pour ne produire que les
  // étapes restantes. Checkpoint absent → guide complet (dégradation propre).
  let resumeCheckpoint: { lessonIndex: number; step: string } | undefined;
  if (resume) {
    const deployment = await Deployment.findOne({ courseId, platform })
      .select('checkpoint')
      .lean();
    resumeCheckpoint = {
      lessonIndex: deployment?.checkpoint?.lessonIndex ?? 0,
      step: deployment?.checkpoint?.step ?? '',
    };
  }

  try {
    const queue = getPackagingQueue();
    // jobId distinct pour le guide de reprise (coexiste avec le guide complet).
    const jobId = resume
      ? makeJobId(courseId, QUEUES.packaging, 'manual-guide-resume', platform)
      : makeJobId(courseId, QUEUES.packaging, 'manual-guide', platform);
    // Un run précédent garderait le jobId réservé : purge avant re-add.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      resume ? 'course-manual-guide-resume' : 'course-manual-guide',
      {
        courseId,
        mode: 'manual-guide',
        platform,
        ...(resume ? { resume: resumeCheckpoint } : {}),
      },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la génération du guide, réessayez plus tard.', code: 'guideGenerationLaunchFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ id: courseId, platform, resume, status: 'queued' }, { status: 202 });
}

/**
 * GET /api/courses/[id]/manual-guide?platform=… — renvoie l'URL présignée du
 * guide si le ZIP existe, sinon 404 { ready: false }. Même contrat que
 * package/route.ts (GET).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  const searchParams = new URL(request.url).searchParams;
  const platform = normalizeManualPlatform(searchParams.get('platform'));
  if (!platform) {
    return apiError('invalidManualPlatform');
  }
  const resume = searchParams.get('resume') === '1';

  const courseId = await ownedCourseId(id, user.id);
  if (!courseId) {
    return apiError('courseNotFound');
  }

  const key = guideKey(courseId, platform, resume);
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
