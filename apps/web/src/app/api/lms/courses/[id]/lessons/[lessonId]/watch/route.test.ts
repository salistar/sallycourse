import { afterEach, describe, expect, it, vi } from 'vitest';

// Tests de POST /api/lms/courses/[id]/lessons/[lessonId]/watch (Prompt 206) :
// auth, ownership (404 non inscrit), URL signée vers la copie filigranée si
// présente (cache), sinon rendu paresseux enfilé + vidéo non filigranée servie.
// Les fonctions PURES (device-sessions, storageKeys) restent réelles ; seules
// les I/O (objectExists/presignedGetUrl, DB, queue) sont mockées.

const requireApiUserMock = vi.fn();
vi.mock('@/lib/session', () => ({ requireApiUser: () => requireApiUserMock() }));

const rateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  extractClientIp: () => '198.51.100.7',
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

const enrollmentFindOneMock = vi.fn();
const lessonFindByIdMock = vi.fn();
const sectionFindByIdMock = vi.fn();
const courseFindByIdMock = vi.fn();
const userFindByIdMock = vi.fn();
const vsUpdateOneMock = vi.fn().mockResolvedValue(undefined);
const vsUpdateManyMock = vi.fn().mockResolvedValue(undefined);
const vsFindMock = vi.fn();
const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  Enrollment: { findOne: (...a: unknown[]) => enrollmentFindOneMock(...a) },
  Lesson: { findById: (...a: unknown[]) => lessonFindByIdMock(...a) },
  Section: { findById: (...a: unknown[]) => sectionFindByIdMock(...a) },
  Course: { findById: (...a: unknown[]) => courseFindByIdMock(...a) },
  User: { findById: (...a: unknown[]) => userFindByIdMock(...a) },
  ViewingSession: {
    updateOne: (...a: unknown[]) => vsUpdateOneMock(...a),
    updateMany: (...a: unknown[]) => vsUpdateManyMock(...a),
    find: (...a: unknown[]) => vsFindMock(...a),
  },
  notify: (...a: unknown[]) => notifyMock(...a),
}));

const objectExistsMock = vi.fn();
const presignedGetUrlMock = vi.fn();
vi.mock('@sallycourse/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    objectExists: (...a: unknown[]) => objectExistsMock(...a),
    presignedGetUrl: (...a: unknown[]) => presignedGetUrlMock(...a),
  };
});

const watermarkAddMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/queues', () => ({
  getWatermarkQueue: () => ({ add: (...a: unknown[]) => watermarkAddMock(...a) }),
  watermarkJobId: (lessonId: string, studentId: string) => `watermark-lesson:${lessonId}:${studentId}`,
  WATERMARK_JOB: 'watermark-lesson',
}));

import { POST } from './route';

const COURSE_ID = '507f1f77bcf86cd799439011';
const LESSON_ID = '507f1f77bcf86cd799439022';
const params = Promise.resolve({ id: COURSE_ID, lessonId: LESSON_ID });

function postRequest(body: unknown = { deviceId: 'device-abcdef-123' }): Request {
  return new Request(`http://localhost/api/lms/courses/${COURSE_ID}/lessons/${LESSON_ID}/watch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  });
}

const lean = (v: unknown) => ({ select: () => ({ lean: () => Promise.resolve(v) }) });
const findLean = (v: unknown) => ({ select: () => ({ lean: () => Promise.resolve(v) }) });

function enrolledVideoLesson() {
  requireApiUserMock.mockResolvedValue({ id: 'student-1', email: 'jane@example.com' });
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() });
  enrollmentFindOneMock.mockReturnValue(lean({ _id: 'enr-1' }));
  lessonFindByIdMock.mockReturnValue(
    lean({ courseId: COURSE_ID, sectionId: 'sec-1', order: 2, type: 'video', assets: { videoUrl: 'courses/x/video.mp4' } }),
  );
  sectionFindByIdMock.mockReturnValue(lean({ order: 1 }));
  vsFindMock.mockReturnValue(findLean([{ deviceId: 'd1', lastSeenAt: new Date(), alertedAt: null }]));
  userFindByIdMock.mockReturnValue(lean({ email: 'jane@example.com' }));
}

afterEach(() => vi.clearAllMocks());

describe('POST …/watch', () => {
  it('exige une authentification', async () => {
    requireApiUserMock.mockResolvedValue(new Response('unauth', { status: 401 }));
    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(401);
  });

  it('400 si deviceId manquant', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    const res = await POST(postRequest({}), { params });
    expect(res.status).toBe(400);
  });

  it('404 si l’étudiant n’est pas inscrit (ownership)', async () => {
    requireApiUserMock.mockResolvedValue({ id: 'student-1' });
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() });
    enrollmentFindOneMock.mockReturnValue(lean(null));
    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(404);
  });

  it('renvoie une URL signée courte vers la copie filigranée si en cache', async () => {
    enrolledVideoLesson();
    objectExistsMock.mockResolvedValue(true);
    presignedGetUrlMock.mockResolvedValue('https://s3/signed-watermarked?exp=300');

    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string; watermarked: boolean; pending: boolean };
    expect(data.watermarked).toBe(true);
    expect(data.pending).toBe(false);
    expect(data.url).toContain('signed-watermarked');
    // TTL COURT (300 s) demandé au presign.
    expect(presignedGetUrlMock).toHaveBeenCalledWith(expect.stringContaining('watermarked/student-1.mp4'), 300);
    expect(watermarkAddMock).not.toHaveBeenCalled();
  });

  it('enfile le rendu paresseux et sert la vidéo non filigranée si absente', async () => {
    enrolledVideoLesson();
    objectExistsMock.mockResolvedValue(false);
    presignedGetUrlMock.mockResolvedValue('https://s3/signed-source?exp=300');

    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string; watermarked: boolean; pending: boolean };
    expect(data.watermarked).toBe(false);
    expect(data.pending).toBe(true);
    expect(watermarkAddMock).toHaveBeenCalledTimes(1);
    const jobArgs = watermarkAddMock.mock.calls[0];
    expect(jobArgs?.[1]).toMatchObject({ courseId: COURSE_ID, lessonId: LESSON_ID, studentId: 'student-1', studentEmail: 'jane@example.com' });
  });

  it('alerte étudiant + auteur au-delà de 2 appareils simultanés (sans blocage)', async () => {
    enrolledVideoLesson();
    // 3 appareils actifs → dépassement.
    const now = new Date();
    vsFindMock.mockReturnValue(
      findLean([
        { deviceId: 'd1', lastSeenAt: now, alertedAt: null },
        { deviceId: 'd2', lastSeenAt: now, alertedAt: null },
        { deviceId: 'd3', lastSeenAt: now, alertedAt: null },
      ]),
    );
    courseFindByIdMock.mockReturnValue(lean({ title: 'Kubernetes', userId: 'author-1' }));
    objectExistsMock.mockResolvedValue(true);
    presignedGetUrlMock.mockResolvedValue('https://s3/signed?exp=300');

    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(200);
    // Étudiant + auteur notifiés, alertedAt posé (throttle).
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(vsUpdateManyMock).toHaveBeenCalled();
    const data = (await res.json()) as { activeDevices: number };
    expect(data.activeDevices).toBe(3);
  });
});
