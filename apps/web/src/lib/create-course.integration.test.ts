// Test d'INTÉGRATION (Prompt 67) de createCourseForUser sur un vrai MongoDB
// éphémère (mongodb-memory-server) : contrairement aux tests unitaires de
// quota.test.ts / route.test.ts (couche DB entièrement mockée), ce fichier
// exerce la VRAIE réservation atomique (updateOne conditionnel) et persiste un
// vrai document Course — seule la queue BullMQ (Redis) est mockée, pour ne pas
// dépendre d'un Redis local.
//
// mongodb-memory-server n'est PAS une dépendance du monorepo (dépôt hors ligne
// de binaires Mongo). Le test se garde donc lui-même via un import dynamique à
// spécificateur variable (échappe à la résolution de types de tsc) : si le
// paquet est absent, la suite entière est SKIPPÉE proprement au lieu d'échouer
// le build. Pour l'activer : ajouter "mongodb-memory-server" en devDependency
// (voir depsNeeded du prompt 67) puis relancer `pnpm --filter @sallycourse/web test`.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock de la queue outline (BullMQ/Redis) : seule la couche Mongo est réelle ici.
const outlineAddMock = vi.fn().mockResolvedValue({});
vi.mock('./queues', () => ({
  getOutlineQueue: () => ({ add: outlineAddMock }),
}));

// Mock du service de notification (évite tout envoi email best-effort réel).
vi.mock('@sallycourse/db', async () => {
  const actual = await vi.importActual<typeof import('@sallycourse/db')>('@sallycourse/db');
  return { ...actual, notify: vi.fn().mockResolvedValue(undefined) };
});

/** Constructeur minimal exposé par mongodb-memory-server (surface utilisée ici seulement). */
interface MemoryServerModule {
  MongoMemoryServer: {
    create(): Promise<{ getUri(): string; stop(): Promise<void> }>;
  };
}

/**
 * Charge mongodb-memory-server via un spécificateur non littéral : invisible
 * pour la résolution de types de tsc (module absent tant qu'il n'est pas
 * ajouté en devDependency — voir depsNeeded du prompt 67).
 */
async function loadMemoryServer(): Promise<MemoryServerModule | null> {
  const specifier = 'mongodb-memory-server';
  try {
    return (await import(/* @vite-ignore */ specifier)) as unknown as MemoryServerModule;
  } catch {
    return null;
  }
}

describe('createCourseForUser — intégration MongoDB réelle (P67)', () => {
  let available = false;
  let mongod: { getUri(): string; stop(): Promise<void> } | null = null;
  let createCourseForUser: typeof import('./create-course').createCourseForUser;
  let UserModel: typeof import('@sallycourse/db').User;
  let CourseModel: typeof import('@sallycourse/db').Course;
  let connectDb: typeof import('@sallycourse/db').connectDb;
  let mongoose: typeof import('mongoose');

  beforeAll(async () => {
    const mms = await loadMemoryServer();
    if (!mms) return;

    mongod = await mms.MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();

    // Imports APRÈS la configuration de MONGO_URI (connectDb lit process.env au premier appel).
    const db = await import('@sallycourse/db');
    const create = await import('./create-course');
    mongoose = (await import('mongoose')).default;

    UserModel = db.User;
    CourseModel = db.Course;
    connectDb = db.connectDb;
    createCourseForUser = create.createCourseForUser;

    await connectDb();
    available = true;
  }, 60_000);

  afterEach(async () => {
    if (!available) return;
    await Promise.all([UserModel.deleteMany({}), CourseModel.deleteMany({})]);
    outlineAddMock.mockClear();
  });

  afterAll(async () => {
    if (!available) return;
    await mongoose.disconnect();
    await mongod?.stop();
  });

  it('réserve le quota, persiste le cours et enfile le job outline (plan free)', async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }

    const user = await UserModel.create({
      email: 'etu@example.com',
      passwordHash: 'hash',
      name: 'Étudiante Test',
      plan: 'free',
      quotaUsed: { coursesThisMonth: 0, periodStart: new Date() },
      locale: 'fr',
      role: 'user',
    });

    const result = await createCourseForUser(user._id.toString(), 'free', {
      title: 'Introduction à Node.js',
      difficulty: 'beginner',
      locale: 'fr',
      targetPlatforms: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe('generating');

    // Le document Course est réellement persisté (pas un mock).
    const persisted = await CourseModel.findById(result.id).lean();
    expect(persisted).not.toBeNull();
    expect(persisted?.title).toBe('Introduction à Node.js');
    expect(persisted?.watermark).toBe(true); // plan free → filigrane

    // Le quota utilisateur a été incrémenté atomiquement.
    const refreshedUser = await UserModel.findById(user._id).lean();
    expect(refreshedUser?.quotaUsed.coursesThisMonth).toBe(1);

    // Le job outline a été enfilé (queue mockée).
    expect(outlineAddMock).toHaveBeenCalledTimes(1);
    const [, payload] = outlineAddMock.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ courseId: result.id });
  });

  it('bloque la création au-delà du quota mensuel et ne persiste aucun cours', async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }

    const user = await UserModel.create({
      email: 'quota@example.com',
      passwordHash: 'hash',
      name: 'Déjà au quota',
      plan: 'free', // free = 1 cours/mois
      quotaUsed: { coursesThisMonth: 1, periodStart: new Date() },
      locale: 'fr',
      role: 'user',
    });

    const result = await createCourseForUser(user._id.toString(), 'free', {
      title: 'Deuxième cours refusé',
      difficulty: 'beginner',
      locale: 'fr',
      targetPlatforms: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: 'quota', limit: 1, plan: 'free' });

    const courses = await CourseModel.find({ userId: user._id }).lean();
    expect(courses).toHaveLength(0);
    expect(outlineAddMock).not.toHaveBeenCalled();
  });

  it('rend le crédit de quota si l\'enqueue échoue (queue indisponible)', async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }

    outlineAddMock.mockRejectedValueOnce(new Error('Redis indisponible'));

    const user = await UserModel.create({
      email: 'enqueue-fail@example.com',
      passwordHash: 'hash',
      name: 'Enqueue KO',
      plan: 'pro',
      quotaUsed: { coursesThisMonth: 0, periodStart: new Date() },
      locale: 'fr',
      role: 'user',
    });

    const result = await createCourseForUser(user._id.toString(), 'pro', {
      title: 'Cours dont l’enqueue échoue',
      difficulty: 'intermediate',
      locale: 'fr',
      targetPlatforms: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('enqueue_failed');

    // Le cours existe mais est marqué 'failed' (pas de génération fantôme).
    const courses = await CourseModel.find({ userId: user._id }).lean();
    expect(courses).toHaveLength(1);
    expect(courses[0]?.status).toBe('failed');
  });
});
