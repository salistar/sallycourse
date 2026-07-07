// Seed idempotent du jeu de données de démo (Prompt 185).
// Exécutable : `pnpm --filter @sallycourse/worker seed`.
// Ne fait AUCUN appel réseau externe (ni Claude, ni TTS) — les assets des cours
// « prêts » pointent vers des clés de stockage cohérentes mais fictives, ce qui
// suffit à peupler et tester l'UI sans lancer de génération.
import mongoose, { type Types } from 'mongoose';
import {
  Course,
  GenerationJob,
  Lesson,
  Quiz,
  Section,
  User,
  connectDb,
  getConfig,
  storageKeys,
  type Outline,
} from '../shared.js';
import { logger } from '../queues/index.js';
import {
  DEMO_ADMIN,
  DEMO_COURSE_TAG,
  DEMO_PASSWORD,
  DEMO_PASSWORD_BCRYPT,
  DEMO_USERS,
  GOLDEN_ARTICLE,
  GOLDEN_OUTLINE,
  GOLDEN_TP,
  GOLDEN_VIDEO_SCRIPT,
  goldenQuizForSection,
  isDemoEmail,
  type DemoUserFixture,
} from './fixtures.js';
// Le plan « generating » réutilise une fixture mock (déterministe).
import { mockOutline } from '../lib/mock-fixtures.js';

/** Supprime tout le contenu de démo précédemment créé (reset idempotent ciblé). */
async function purgeDemoData(): Promise<void> {
  const demoUsers = await User.find({ email: { $regex: `@${escapeRegex('demo.sallycourse.test')}$`, $options: 'i' } })
    .select('_id')
    .lean();
  const userIds = demoUsers.map((u) => u._id);

  // Cours de démo : ceux appartenant aux users de démo OU marqués DEMO_COURSE_TAG.
  const demoCourses = await Course.find({
    $or: [{ userId: { $in: userIds } }, { title: { $regex: `^${escapeRegex(DEMO_COURSE_TAG)}` } }],
  })
    .select('_id')
    .lean();
  const courseIds = demoCourses.map((c) => c._id);

  await Promise.all([
    Lesson.deleteMany({ courseId: { $in: courseIds } }),
    Section.deleteMany({ courseId: { $in: courseIds } }),
    Quiz.deleteMany({ courseId: { $in: courseIds } }),
    GenerationJob.deleteMany({ courseId: { $in: courseIds } }),
  ]);
  await Course.deleteMany({ _id: { $in: courseIds } });
  await User.deleteMany({ _id: { $in: userIds } });

  logger.info(
    { users: userIds.length, courses: courseIds.length },
    'seed : données de démo précédentes purgées',
  );
}

/** Échappe une chaîne pour une utilisation littérale dans une RegExp. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Crée un utilisateur de démo (hash bcrypt pré-calculé, quota au mois courant). */
async function createUser(fixture: DemoUserFixture): Promise<Types.ObjectId> {
  const now = new Date();
  const user = await User.create({
    email: fixture.email,
    passwordHash: DEMO_PASSWORD_BCRYPT,
    name: fixture.name,
    plan: fixture.plan,
    role: fixture.role,
    locale: 'fr',
    quotaUsed: { coursesThisMonth: 0, periodStart: new Date(now.getFullYear(), now.getMonth(), 1) },
  });
  return user._id;
}

/** (a) Cours « draft » vide — juste un titre, aucun contenu. */
async function seedDraftCourse(userId: Types.ObjectId): Promise<void> {
  await Course.create({
    userId,
    title: `${DEMO_COURSE_TAG} Brouillon — Découvrir Docker`,
    difficulty: 'beginner',
    status: 'draft',
    locale: 'fr',
    targetPlatforms: [],
  });
}

/**
 * (b) Cours « generating » — outline présent, sections/leçons à statuts variés,
 * et un GenerationJob à mi-parcours.
 */
async function seedGeneratingCourse(userId: Types.ObjectId): Promise<void> {
  const title = `${DEMO_COURSE_TAG} Génération en cours — Python pour l'automatisation`;
  const outline: Outline = mockOutline("Python pour l'automatisation");
  const course = await Course.create({
    userId,
    title,
    difficulty: 'intermediate',
    status: 'generating',
    locale: 'fr',
    outline,
    targetPlatforms: ['udemy'],
  });

  // Statuts variés : la 1re section prête, la 2e en cours, le reste en attente.
  const statusForSection = (sIndex: number): 'ready' | 'generating' | 'pending' =>
    sIndex === 0 ? 'ready' : sIndex === 1 ? 'generating' : 'pending';

  for (const [sIndex, sectionFx] of outline.sections.entries()) {
    const section = await Section.create({ courseId: course._id, order: sIndex, title: sectionFx.title });
    for (const [lIndex, lessonFx] of sectionFx.lessons.entries()) {
      await Lesson.create({
        courseId: course._id,
        sectionId: section._id,
        order: lIndex,
        title: lessonFx.title,
        type: lessonFx.type,
        durationMin: lessonFx.durationMin,
        summary: lessonFx.summary,
        status: statusForSection(sIndex),
        assets: { screenshots: [], slides: [] },
      });
    }
  }

  await GenerationJob.create({
    courseId: course._id,
    step: 'content-generation',
    progress: 45,
    attempts: 1,
    logs: [
      { ts: new Date(), level: 'info', msg: 'Plan validé, génération du contenu démarrée' },
      { ts: new Date(), level: 'info', msg: 'Section 1 terminée (5 leçons)' },
      { ts: new Date(), level: 'info', msg: 'Section 2 en cours…' },
    ],
  });
}

/**
 * (c) Cours « golden » COMPLET et prêt : 5 sections, ~12 leçons toutes prêtes
 * avec des assets fictifs cohérents, un Quiz par section, un qaReport passé.
 */
async function seedGoldenCourse(userId: Types.ObjectId): Promise<void> {
  const course = await Course.create({
    userId,
    title: `${DEMO_COURSE_TAG} ${GOLDEN_OUTLINE.title}`,
    difficulty: 'intermediate',
    status: 'ready',
    locale: 'fr',
    outline: GOLDEN_OUTLINE,
    targetPlatforms: ['udemy', 'youtube'],
    coverImageUrl: storageKeys.course('placeholder').marketing('cover-750x422.png'),
  });
  const courseId = course._id.toString();
  const keys = storageKeys.course(courseId);

  let totalVideoMinutes = 0;

  for (const [sIndex, sectionFx] of GOLDEN_OUTLINE.sections.entries()) {
    const section = await Section.create({ courseId: course._id, order: sIndex, title: sectionFx.title });

    let quizLessonId: Types.ObjectId | null = null;

    for (const [lIndex, lessonFx] of sectionFx.lessons.entries()) {
      const lessonKeys = keys.lesson(sIndex, lIndex);
      // Assets fictifs mais cohérents selon le type de leçon.
      const assets: Record<string, unknown> = { screenshots: [], slides: [] };
      let script: unknown = null;

      if (lessonFx.type === 'video') {
        totalVideoMinutes += lessonFx.durationMin;
        assets.videoUrl = lessonKeys.video();
        assets.srtUrl = lessonKeys.captionsSrt();
        assets.vttUrl = lessonKeys.captionsVtt();
        assets.audioUrl = lessonKeys.audio(0);
        assets.slides = GOLDEN_VIDEO_SCRIPT.slides.map((_, i) => lessonKeys.slide(i));
        script = GOLDEN_VIDEO_SCRIPT;
      } else if (lessonFx.type === 'article') {
        assets.articleMd = lessonKeys.article();
        assets.screenshots = [lessonKeys.screenshot(0)];
        script = GOLDEN_ARTICLE;
      } else if (lessonFx.type === 'tp') {
        assets.screenshots = [lessonKeys.screenshot(0), lessonKeys.screenshot(1)];
        script = GOLDEN_TP;
      }

      const lesson = await Lesson.create({
        courseId: course._id,
        sectionId: section._id,
        order: lIndex,
        title: lessonFx.title,
        type: lessonFx.type,
        durationMin: lessonFx.durationMin,
        summary: lessonFx.summary,
        generatedSummary: `Résumé généré : ${lessonFx.summary}`,
        status: 'ready',
        script,
        assets,
      });

      if (lessonFx.type === 'quiz') quizLessonId = lesson._id;
    }

    // Un Quiz par section, ancré sur la leçon quiz si présente, sinon rattaché
    // à la section (lessonId = première leçon de la section).
    const anchorLessonId =
      quizLessonId ??
      (await Lesson.findOne({ sectionId: section._id }).select('_id').lean())?._id;
    if (anchorLessonId) {
      await Quiz.create({
        courseId: course._id,
        sectionId: section._id,
        lessonId: anchorLessonId,
        questions: goldenQuizForSection(sIndex),
      });
    }
  }

  // Rapport QA « passé » cohérent avec le contenu créé.
  course.qaReport = {
    passed: true,
    generatedAt: new Date().toISOString(),
    checks: [
      { code: 'total-video-minutes', ok: totalVideoMinutes >= 30, detail: `${totalVideoMinutes} min de vidéo` },
      { code: 'min-sections', ok: GOLDEN_OUTLINE.sections.length >= 5, detail: `${GOLDEN_OUTLINE.sections.length} sections` },
      { code: 'no-empty-lessons', ok: true, detail: 'toutes les leçons ont un contenu' },
      { code: 'quiz-valid', ok: true, detail: 'un quiz valide par section' },
      { code: 'no-screenshot-placeholder', ok: true, detail: 'aucun placeholder restant' },
    ],
  };
  await course.save();

  logger.info({ courseId, totalVideoMinutes }, 'seed : cours golden créé (ready)');
}

/** Point d'entrée du seed. */
async function main(): Promise<void> {
  const config = getConfig();
  await connectDb(config.MONGO_URI);
  logger.info('seed : connexion Mongo établie');

  await purgeDemoData();

  // Comptes : admin + un par plan.
  const adminId = await createUser(DEMO_ADMIN);
  const userIds = new Map<string, Types.ObjectId>();
  for (const fixture of DEMO_USERS) userIds.set(fixture.plan, await createUser(fixture));
  logger.info({ total: DEMO_USERS.length + 1 }, 'seed : comptes de démo créés');

  // Les 3 cours appartiennent à l'utilisateur « pro » (démo réaliste).
  const proId = userIds.get('pro') ?? adminId;
  await seedDraftCourse(proId);
  await seedGeneratingCourse(proId);
  await seedGoldenCourse(proId);

  logger.info(
    {
      admin: DEMO_ADMIN.email,
      password: DEMO_PASSWORD,
      note: 'Tous les comptes de démo partagent ce mot de passe.',
    },
    'seed : terminé ✅',
  );

  await mongoose.disconnect();
}

// Exécution directe uniquement (pas à l'import depuis les tests).
main().catch((err) => {
  logger.error({ err }, 'seed : échec');
  process.exitCode = 1;
  void mongoose.disconnect();
});
