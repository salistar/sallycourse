import { createHash } from 'node:crypto';
import { apiError } from '@/lib/api-error';
import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  connectDb,
  Course as CourseModel,
  Enrollment as EnrollmentModel,
  Lesson as LessonModel,
  Section as SectionModel,
  User as UserModel,
  ViewingSession as ViewingSessionModel,
  notify,
} from '@sallycourse/db';
import {
  evaluateConcurrentSessions,
  objectExists,
  presignedGetUrl,
  shouldAlertAccountSharing,
  storageKeys,
} from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { getWatermarkQueue, watermarkJobId, WATERMARK_JOB } from '@/lib/queues';

/**
 * POST /api/lms/courses/[id]/lessons/[lessonId]/watch (Prompt 206) — émet à la
 * demande, pour un étudiant INSCRIT, une URL SIGNÉE à TTL COURT (300 s) vers SA
 * copie filigranée de la leçon. La clé S3 brute n'est JAMAIS exposée.
 *
 * Flux :
 *   - vérifie l'inscription (ownership → 404 : on ne révèle pas la leçon) ;
 *   - enregistre la session de visionnage (empreinte d'appareil hachée) et
 *     détecte le partage de compte (> 2 appareils simultanés) → alerte étudiant
 *     + signalement auteur, SANS blocage automatique ;
 *   - si la copie filigranée existe déjà (cache par leçon×étudiant) → URL signée
 *     vers cette copie ; sinon on enfile le rendu paresseux ET on sert la vidéo
 *     NON filigranée en attendant (la lecture n'est jamais bloquée).
 */

export const dynamic = 'force-dynamic';

/** TTL COURT des URLs signées (décision produit P206). */
const SIGNED_URL_TTL_SEC = 300;
const WATCH_USER_LIMIT = { limit: 60, windowSec: 300 };

const bodySchema = z.object({
  /** Identifiant d'appareil stable généré côté client (localStorage). */
  deviceId: z.string().trim().min(8).max(200),
});

/** Empreinte opaque et stable d'un appareil (jamais l'IP/UA en clair en base). */
function hashDevice(deviceId: string, userAgent: string): string {
  return createHash('sha256').update(`${deviceId}|${userAgent}`).digest('hex');
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id: courseId, lessonId } = await params;
  if (!isValidObjectId(courseId) || !isValidObjectId(lessonId)) {
    return apiError('notFound');
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide (deviceId requis).', code: 'invalidRequestDeviceId' }, { status: 400 });
  }

  const limit = await rateLimit(`lms-watch:user:${user.id}`, WATCH_USER_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Trop de requêtes, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  await connectDb();

  // Ownership pédagogique : l'étudiant doit être inscrit — sinon 404 (on ne
  // révèle pas l'existence de la leçon, convention de sécurité du repo).
  const enrollment = await EnrollmentModel.findOne({ studentId: user.id, courseId }).select('_id').lean();
  if (!enrollment) {
    return apiError('notFound');
  }

  const lesson = await LessonModel.findById(lessonId)
    .select('courseId sectionId order type assets.videoUrl')
    .lean();
  if (!lesson || String(lesson.courseId) !== courseId) {
    return apiError('notFound');
  }
  if (lesson.type !== 'video') {
    return NextResponse.json({ error: 'Cette leçon n’est pas une vidéo.', code: 'lessonNotVideo' }, { status: 400 });
  }

  // ── Suivi d'appareil + détection de partage de compte ──────────
  const userAgent = request.headers.get('user-agent') ?? '';
  const deviceId = hashDevice(parsed.data.deviceId, userAgent);
  const now = new Date();
  await ViewingSessionModel.updateOne(
    { studentId: user.id, deviceId },
    { $set: { lastSeenAt: now, courseId }, $setOnInsert: { studentId: user.id, deviceId } },
    { upsert: true },
  ).catch(() => undefined);

  const sessions = await ViewingSessionModel.find({ studentId: user.id })
    .select('deviceId lastSeenAt alertedAt')
    .lean();
  const concurrency = evaluateConcurrentSessions(
    sessions.map((s) => ({ deviceId: s.deviceId, lastSeenAt: new Date(s.lastSeenAt).getTime() })),
    { now: now.getTime() },
  );

  if (concurrency.overLimit) {
    const lastAlertedAt = sessions.reduce<number | null>((acc, s) => {
      const t = s.alertedAt ? new Date(s.alertedAt).getTime() : null;
      return t !== null && (acc === null || t > acc) ? t : acc;
    }, null);
    if (shouldAlertAccountSharing(true, lastAlertedAt, { now: now.getTime() })) {
      await ViewingSessionModel.updateMany({ studentId: user.id }, { $set: { alertedAt: now } }).catch(() => undefined);
      const course = await CourseModel.findById(courseId).select('title userId').lean();
      const count = concurrency.activeCount;
      // Alerte à l'étudiant (jamais de blocage — décision produit).
      await notify(String(user.id), {
        type: 'account_sharing_suspected',
        title: 'Activité inhabituelle sur votre compte',
        body: `Votre compte est lu sur ${count} appareils simultanément. Si ce n’est pas vous, changez votre mot de passe. Le partage de compte n’est pas autorisé.`,
        link: `/learn/${courseId}`,
      }).catch(() => undefined);
      // Signalement à l'auteur du cours.
      if (course?.userId) {
        await notify(String(course.userId), {
          type: 'account_sharing_suspected',
          title: 'Partage de compte suspecté',
          body: `Un étudiant lit « ${course.title} » sur ${count} appareils simultanément.`,
          link: `/dashboard/courses/${courseId}`,
        }).catch(() => undefined);
      }
    }
  }

  // ── URL signée courte : copie filigranée si présente, sinon rendu paresseux ──
  const rawVideoUrl = lesson.assets?.videoUrl;
  // Source externe (http) : pas de filigrane possible — on renvoie tel quel.
  if (rawVideoUrl && /^https?:\/\//i.test(rawVideoUrl)) {
    return NextResponse.json({ url: rawVideoUrl, watermarked: false, pending: false, activeDevices: concurrency.activeCount });
  }

  const section = await SectionModel.findById(lesson.sectionId).select('order').lean();
  const keys = storageKeys.course(courseId).lesson(section?.order ?? 0, lesson.order);
  const watermarkedKey = keys.watermarkedVideo(String(user.id));
  const sourceKey = rawVideoUrl || keys.video();

  let cached = false;
  try {
    cached = await objectExists(watermarkedKey);
  } catch {
    cached = false;
  }

  if (cached) {
    const url = await presignedGetUrl(watermarkedKey, SIGNED_URL_TTL_SEC);
    return NextResponse.json({ url, watermarked: true, pending: false, activeDevices: concurrency.activeCount });
  }

  // Rendu filigrané absent : on l'enfile (best-effort, dédupliqué) et on sert la
  // vidéo NON filigranée en attendant — la lecture n'est jamais bloquée.
  const studentEmail =
    (await UserModel.findById(user.id).select('email').lean())?.email ?? user.email ?? '';
  if (studentEmail) {
    try {
      await getWatermarkQueue().add(
        WATERMARK_JOB,
        { courseId, lessonId, studentId: String(user.id), studentEmail },
        { jobId: watermarkJobId(lessonId, String(user.id)), removeOnComplete: 50, removeOnFail: 100 },
      );
    } catch {
      // Redis indisponible : on sert quand même la vidéo (best-effort).
    }
  }

  const url = await presignedGetUrl(sourceKey, SIGNED_URL_TTL_SEC);
  return NextResponse.json({ url, watermarked: false, pending: true, activeDevices: concurrency.activeCount });
}
