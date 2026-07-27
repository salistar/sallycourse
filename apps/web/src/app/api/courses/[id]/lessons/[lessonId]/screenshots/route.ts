import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { apiError } from '@/lib/api-error';
import { deleteObject, presignedGetUrl, storageKeys, tpSchema, uploadObject } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel, Section as SectionModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';

/**
 * /api/courses/[id]/lessons/[lessonId]/screenshots — CAPTURES MANUELLES PAR
 * ÉTAPE DE TP (Lot 5, plan 2026-07-20). L'auteur remplace/ajoute la capture
 * d'une étape quand la capture automatique (Playwright) a échoué, produit un
 * carton dégradé, ou ne convient simplement pas. `assets.screenshots[i]` est
 * ALIGNÉ PAR INDEX sur `tp.steps[i]` — jamais compacté (une suppression laisse
 * un « trou » à sa position, pas un décalage des étapes suivantes).
 *  - POST (multipart `file` + `index`) : upload SYNCHRONE (comme le
 *    remplacement manuel d'image de slide, Lot 3 — pas de resize serveur,
 *    la galerie affiche en `object-cover`) → remplace le carton/404 ;
 *  - DELETE (`?index=N`) : efface CETTE capture (place un trou, ne décale
 *    rien) — l'auteur peut ensuite en uploader une nouvelle ou relancer la
 *    capture automatique complète (bouton « Recapturer » = regenerate
 *    render-only, qui écrase TOUTES les captures).
 * Ownership vérifiée à chaque appel (404 volontaire, jamais 403).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_MB = 10;
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const UPLOAD_USER_LIMIT = { limit: 40, windowSec: 600 };
const UPLOAD_IP_LIMIT = { limit: 120, windowSec: 600 };

/** Charge la leçon TP possédée par l'utilisateur + son nombre d'étapes. 404 volontaire sinon. */
async function loadOwnedTpLesson(courseId: string, lessonId: string, userId: string) {
  if (!isValidObjectId(courseId) || !isValidObjectId(lessonId)) {
    return apiError('lessonNotFound');
  }
  await connectDb();
  const course = await CourseModel.findOne({ _id: courseId, userId }).select('_id');
  if (!course) return apiError('lessonNotFound');
  const lesson = await LessonModel.findOne({ _id: lessonId, courseId });
  if (!lesson || lesson.type !== 'tp') return apiError('lessonNotFound');

  const parsed = tpSchema.safeParse(lesson.script);
  const stepCount = parsed.success ? parsed.data.steps.length : 0;
  const section = await SectionModel.findById(lesson.sectionId).select('order').lean();
  if (!section) return apiError('lessonNotFound');

  const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);
  return { lesson, stepCount, keys };
}

/** Étend `screenshots` à `length` positions (padding par chaîne vide) — préserve l'alignement par index. */
function padTo(screenshots: string[], length: number): string[] {
  const next = [...screenshots];
  while (next.length < length) next.push('');
  return next;
}

/**
 * Recalcule `screenshotsDegraded` après une édition manuelle : le check QA
 * `screenshots-valid` (Lot 1.2, lib/qa.ts) compte les indices dégradés pour
 * juger si un TP a assez de captures exploitables. Un slot VIDE (supprimé
 * manuellement, ou jamais produit) est au moins aussi défaillant qu'un carton
 * de repli automatique — il DOIT rester compté, sinon une suppression
 * manuelle ferait artificiellement baisser le taux de défaut détecté.
 */
function recomputeDegraded(screenshots: string[], previousDegraded: number[] | undefined): number[] | undefined {
  const emptyIndices = screenshots.reduce<number[]>((acc, url, i) => {
    if (!url) acc.push(i);
    return acc;
  }, []);
  const stillDegraded = (previousDegraded ?? []).filter((i) => screenshots[i]);
  const merged = Array.from(new Set([...stillDegraded, ...emptyIndices])).sort((a, b) => a - b);
  return merged.length > 0 ? merged : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`tp-screenshot:user:${user.id}`, UPLOAD_USER_LIMIT),
    rateLimit(`tp-screenshot:ip:${ip}`, UPLOAD_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop d’envois, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  const { id, lessonId } = await params;
  const loaded = await loadOwnedTpLesson(id, lessonId, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, stepCount, keys } = loaded;

  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > (MAX_UPLOAD_MB + 2) * 1024 * 1024) {
    return NextResponse.json(
      { error: `Image trop lourde (max ${MAX_UPLOAD_MB} Mo).`, code: 'screenshotTooLargeDeclared' },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('invalidMultipart');
  }

  const indexRaw = form.get('index');
  const index = typeof indexRaw === 'string' ? Number.parseInt(indexRaw, 10) : NaN;
  if (!Number.isInteger(index) || index < 0 || index >= stepCount) {
    return NextResponse.json({ error: 'Index d’étape invalide.', code: 'invalidStepIndex' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Image manquante (champ « file »).', code: 'missingFile' }, { status: 400 });
  }
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Format non supporté (PNG, JPEG ou WebP attendu).', code: 'unsupportedImageFormat' },
      { status: 415 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Image vide.', code: 'emptyImage' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `Image trop lourde (max ${MAX_UPLOAD_MB} Mo).`, code: 'screenshotTooLarge' },
      { status: 413 },
    );
  }

  const key = keys.screenshot(index);
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadObject(key, buffer, file.type);
  } catch {
    return NextResponse.json({ error: 'Échec du stockage de l’image.', code: 'imageStorageFailed' }, { status: 502 });
  }

  const screenshots = padTo([...(lesson.assets.screenshots ?? [])], stepCount);
  screenshots[index] = key;
  lesson.assets.screenshots = screenshots;
  lesson.assets.screenshotsDegraded = recomputeDegraded(screenshots, lesson.assets.screenshotsDegraded);
  lesson.markModified('assets');
  await lesson.save();

  const url = await presignedGetUrl(key).catch(() => undefined);
  return NextResponse.json({ index, url }, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, lessonId } = await params;
  const loaded = await loadOwnedTpLesson(id, lessonId, user.id);
  if (loaded instanceof Response) return loaded;
  const { lesson, stepCount, keys } = loaded;

  const { searchParams } = new URL(request.url);
  const index = Number.parseInt(searchParams.get('index') ?? '', 10);
  if (!Number.isInteger(index) || index < 0 || index >= stepCount) {
    return NextResponse.json({ error: 'Index d’étape invalide.', code: 'invalidStepIndex' }, { status: 400 });
  }

  await deleteObject(keys.screenshot(index)).catch(() => undefined);

  const screenshots = padTo([...(lesson.assets.screenshots ?? [])], stepCount);
  screenshots[index] = '';
  lesson.assets.screenshots = screenshots;
  lesson.assets.screenshotsDegraded = recomputeDegraded(screenshots, lesson.assets.screenshotsDegraded);
  lesson.markModified('assets');
  await lesson.save();

  return NextResponse.json({ index }, { status: 200 });
}
