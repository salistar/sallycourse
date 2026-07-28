// Contrôle qualité automatique (Prompt 26) : avant de publier un cours, on
// vérifie qu'il respecte les garde-fous Udemy et qu'aucun asset n'est cassé.
//
// runCourseQa(courseId) charge le cours, ses sections/leçons/quiz, exécute une
// batterie de checks (durée vidéo, nombre de sections, vidéos jouables + audio
// non silencieux via ffprobe, absence de placeholders {{screenshot:}} restants,
// quiz valides, aucune leçon vide/failed) puis persiste Course.qaReport. Le
// cours passe 'ready' UNIQUEMENT si tous les checks passent, sinon 'failed'
// avec le rapport listant les problèmes — la publication s'appuie dessus.
//
// Les fonctions de check PURES (quiz, placeholders) sont exportées et testées
// isolément ; l'orchestrateur runCourseQa fait les I/O (Mongo, storage, ffprobe).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import {
  Course,
  Lesson,
  Quiz,
  Section,
  UDEMY,
  QUIZ,
  extractScreenshotPlaceholders,
  getConfig,
  objectExists,
  storageKeys,
  type ILesson,
  type IQuiz,
  readObjectBuffer,
} from '../shared.js';
import { logger } from '../queues/index.js';

// (« stream S3 -> Buffer » factorise dans @sallycourse/shared/storage —
// audit dedup 2026-07-26 : readObjectBuffer/streamToBuffer importes.)

// ── Codes de check (stables : consommés par l'UI web du rapport) ─────
export const QA_CHECK_CODES = [
  'video-duration',
  'section-count',
  'video-playable',
  'article-placeholders',
  'quiz-valid',
  'lessons-complete',
  'screenshots-valid',
  'illustration-consistency',
  'audio-noise-floor',
] as const;
export type QaCheckCode = (typeof QA_CHECK_CODES)[number];

export interface QaCheck {
  code: QaCheckCode;
  ok: boolean;
  detail: string;
}

export interface QaReport {
  passed: boolean;
  /** Horodatage ISO de l'exécution du contrôle. */
  ranAt: string;
  checks: QaCheck[];
}

/** Seuil de volume moyen (dBFS) sous lequel un audio est jugé silencieux. */
export const SILENCE_MEAN_VOLUME_DB = -50;

/**
 * Seuil de plancher de bruit (RMS trough, dBFS) au-dessus duquel un souffle de
 * fond devient perceptible (audit qualité voix 2026-07-29 : Chatterbox mesuré
 * à −60 dB, contre −92 dB pour Qwen3-TTS sur un échantillon identique — la
 * marge sépare les deux moteurs sans être trop stricte pour un léger souffle
 * ambiant acceptable).
 */
export const NOISE_FLOOR_DB = -70;

// ────────────────────────────────────────────────────────────────────
// Checks PURS (sans I/O) — exportés pour les tests unitaires
// ────────────────────────────────────────────────────────────────────

/**
 * Valide un lot de quiz : chaque question doit avoir exactement une bonne
 * réponse (correctIndex dans les bornes 0..CHOICES-1) et le bon nombre de
 * choix. Retourne la liste des problèmes (vide = conforme).
 */
export function checkQuizzes(quizzes: Pick<IQuiz, 'questions'>[]): string[] {
  const problems: string[] = [];

  quizzes.forEach((quiz, qi) => {
    if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) {
      problems.push(`Quiz #${qi + 1} : aucune question.`);
      return;
    }
    quiz.questions.forEach((question, index) => {
      const choices = question.choices ?? [];
      if (choices.length !== QUIZ.CHOICES_PER_QUESTION) {
        problems.push(
          `Quiz #${qi + 1} question ${index + 1} : ${choices.length} choix (attendu ${QUIZ.CHOICES_PER_QUESTION}).`,
        );
      }
      const ci = question.correctIndex;
      if (typeof ci !== 'number' || ci < 0 || ci >= choices.length) {
        problems.push(
          `Quiz #${qi + 1} question ${index + 1} : correctIndex ${ci} hors bornes (0..${choices.length - 1}).`,
        );
      }
    });
  });

  return problems;
}

/**
 * Scanne un lot d'articles (Markdown) et signale ceux qui contiennent encore
 * des placeholders `{{screenshot:…}}` non remplacés par une capture réelle.
 */
export function checkArticlePlaceholders(
  articles: { title: string; markdown: string }[],
): string[] {
  const problems: string[] = [];
  for (const article of articles) {
    const remaining = extractScreenshotPlaceholders(article.markdown);
    if (remaining.length > 0) {
      problems.push(
        `« ${article.title} » : ${remaining.length} placeholder(s) {{screenshot:…}} non remplacé(s).`,
      );
    }
  }
  return problems;
}

/**
 * Correctif N2 (audit 2026-07-20) : jusqu'ici, un TP dont TOUTES les captures
 * étaient des cartons de repli (`{{screenshot:}}` jamais atteint, 404 ou état
 * par défaut d'un outil tiers) passait le QA sans aucun signal — seul
 * `checkArticlePlaceholders` existait, et un carton rendu en PNG n'est pas un
 * placeholder textuel. Ce check exploite `screenshotsDegraded` (désormais
 * persisté par le processor, cf. media/screenshot-capture.ts) : au-delà de la
 * MOITIÉ des captures d'une leçon TP en mode dégradé, le TP est signalé —
 * l'apprenant se retrouverait sinon face à un exercice sans support visuel
 * réel.
 */
export function checkTpScreenshots(
  tpLessons: { title: string; screenshotsCount: number; degradedCount: number }[],
): string[] {
  const problems: string[] = [];
  for (const lesson of tpLessons) {
    if (lesson.screenshotsCount === 0) continue; // TP sans capture attendue (ex. purement terminal) — hors périmètre.
    if (lesson.degradedCount * 2 >= lesson.screenshotsCount) {
      problems.push(
        `« ${lesson.title} » : ${lesson.degradedCount}/${lesson.screenshotsCount} capture(s) en mode dégradé (carton de repli, pas une vraie capture).`,
      );
    }
  }
  return problems;
}

/**
 * Correctif 1.8 (audit 2026-07-20) : l'illustration SDXL par leçon est
 * best-effort PAR CONCEPTION (repli sur un motif géométrique si Modal est
 * indisponible/désactivé) — son absence n'est donc PAS un défaut en soi :
 * un cours dont AUCUNE vidéo n'a d'illustration peut simplement avoir Modal
 * désactivé. Ce qui EST un défaut (constaté sur le cours audité : une seule
 * vidéo du cours sans illustration, contrairement au reste) est une
 * couverture PARTIELLE — signe d'un échec silencieux ponctuel plutôt que
 * d'un choix de configuration global.
 */
export function checkIllustrationConsistency(
  videoLessons: { title: string; hasIllustration: boolean }[],
): string[] {
  if (videoLessons.length === 0) return [];
  const withIllustration = videoLessons.filter((l) => l.hasIllustration).length;
  if (withIllustration === 0 || withIllustration === videoLessons.length) return [];
  const missing = videoLessons.filter((l) => !l.hasIllustration);
  return [
    `${missing.length}/${videoLessons.length} vidéo(s) sans illustration alors que d'autres leçons du cours en ont une : ${missing
      .map((l) => `« ${l.title} »`)
      .join(', ')}.`,
  ];
}

/**
 * Vérifie la durée vidéo cumulée d'un cours (somme des durées mesurées, en
 * minutes) contre le minimum Udemy. Retourne le problème éventuel (ou null).
 */
export function checkTotalVideoMinutes(totalMinutes: number): string | null {
  if (totalMinutes < UDEMY.MIN_TOTAL_VIDEO_MINUTES) {
    return `Durée vidéo totale ${totalMinutes.toFixed(1)} min — minimum requis ${UDEMY.MIN_TOTAL_VIDEO_MINUTES} min.`;
  }
  return null;
}

/**
 * Vérifie le plancher de bruit d'une leçon vidéo. `null` = non mesurable
 * (piste silencieuse ou sonde ffmpeg indisponible) : n'est jamais bloquant,
 * seul un plancher mesuré ET trop élevé l'est.
 */
export function checkNoiseFloor(title: string, noiseFloorDb: number | null): string | null {
  if (noiseFloorDb === null || noiseFloorDb <= NOISE_FLOOR_DB) return null;
  return `« ${title} » : souffle de fond perceptible (plancher de bruit ${noiseFloorDb.toFixed(1)} dB > ${NOISE_FLOOR_DB} dB).`;
}

/** Vérifie le nombre de sections contre le minimum Udemy. Retourne le problème éventuel. */
export function checkSectionCount(sectionCount: number): string | null {
  if (sectionCount < UDEMY.MIN_SECTIONS) {
    return `${sectionCount} section(s) — minimum requis ${UDEMY.MIN_SECTIONS}.`;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Sonde média (ffprobe / ffmpeg)
// ────────────────────────────────────────────────────────────────────

export interface ProbeResult {
  /** Durée du média en secondes (0 si indéterminée). */
  durationSec: number;
  /** true si le média possède au moins une piste audio. */
  hasAudio: boolean;
  /** Volume moyen mesuré (dBFS) ou null si non mesurable. */
  meanVolumeDb: number | null;
  /**
   * Plancher de bruit (RMS trough, dBFS) — audit qualité voix 2026-07-29 :
   * distingue un souffle de fond permanent (Chatterbox, ~−60 dB) d'un silence
   * réel entre les mots (Qwen3-TTS, ~−90 dB). null si non mesurable.
   */
  noiseFloorDb: number | null;
}

/** Extrait le mean_volume (dBFS) de la sortie ffmpeg volumedetect. */
export function parseMeanVolume(stderr: string): number | null {
  const match = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  return match ? Number.parseFloat(match[1]!) : null;
}

/** Extrait le RMS trough dB de la sortie ffmpeg astats (plancher de bruit). */
export function parseNoiseFloor(stderr: string): number | null {
  const match = stderr.match(/RMS trough dB:\s*(-?\d+(?:\.\d+)?|-inf)/);
  if (!match) return null;
  return match[1] === '-inf' ? -100 : Number.parseFloat(match[1]!);
}

/**
 * Sonde un fichier vidéo local : durée + présence d'une piste audio (ffprobe),
 * puis volume moyen sur un échantillon de 15 s (ffmpeg volumedetect). Best-effort :
 * une erreur de sonde renvoie des valeurs neutres plutôt que de jeter.
 */
export async function probeVideoFile(file: string): Promise<ProbeResult> {
  let durationSec = 0;
  let hasAudio = false;
  let meanVolumeDb: number | null = null;
  let noiseFloorDb: number | null = null;

  try {
    const { stdout } = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type',
      '-of',
      'json',
      file,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string }[];
    };
    durationSec = Number.parseFloat(parsed.format?.duration ?? '0') || 0;
    hasAudio = (parsed.streams ?? []).some((s) => s.codec_type === 'audio');
  } catch (err) {
    logger.warn({ file, err }, 'ffprobe: sonde durée/audio impossible');
  }

  if (hasAudio) {
    try {
      // volumedetect sur les 15 premières secondes : suffisant pour détecter un silence total.
      const { stderr } = await execa('ffmpeg', [
        '-t',
        '15',
        '-i',
        file,
        '-af',
        'volumedetect',
        '-f',
        'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ]);
      meanVolumeDb = parseMeanVolume(stderr);
    } catch (err) {
      logger.warn({ file, err }, 'ffmpeg volumedetect impossible');
    }

    try {
      // astats sur le flux entier : le plancher de bruit (silences entre les
      // mots) doit être mesuré sur toute la piste, pas seulement 15 s.
      const { stderr } = await execa('ffmpeg', [
        '-i',
        file,
        '-af',
        'astats=measure_perchannel=none',
        '-f',
        'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ]);
      noiseFloorDb = parseNoiseFloor(stderr);
    } catch (err) {
      logger.warn({ file, err }, 'ffmpeg astats (plancher de bruit) impossible');
    }
  }

  return { durationSec, hasAudio, meanVolumeDb, noiseFloorDb };
}

/**
 * Sonde la vidéo d'une leçon depuis le storage : télécharge l'objet dans un
 * dossier temporaire puis délègue à probeVideoFile. Retourne null si la clé est
 * absente ou illisible (vidéo non rendue).
 */
async function probeLessonVideo(videoKey: string): Promise<ProbeResult | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qa-video-'));
  try {
    const buffer = await readObjectBuffer(videoKey);
    const localPath = path.join(dir, 'video.mp4');
    await writeFile(localPath, buffer);
    return await probeVideoFile(localPath);
  } catch (err) {
    logger.warn({ videoKey, err }, 'QA: vidéo de leçon illisible depuis le storage');
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ────────────────────────────────────────────────────────────────────
// Orchestrateur
// ────────────────────────────────────────────────────────────────────

/** Charge le Markdown d'un article depuis sa clé S3 (best-effort). */
async function readArticleMarkdown(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  try {
    return (await readObjectBuffer(key)).toString('utf-8');
  } catch (err) {
    logger.warn({ key, err }, 'QA: article illisible depuis le storage');
    return null;
  }
}

/** Type minimal d'une leçon hydratée nécessaire au QA. */
type LessonForQa = Pick<ILesson, 'title' | 'type' | 'status' | 'durationMin' | 'assets' | 'order'> & {
  sectionId: { toString(): string };
};

/**
 * Exécute le contrôle qualité complet d'un cours et persiste Course.qaReport.
 * Fait basculer le cours : 'ready' si passed, sinon 'failed'. Ne jette pas sur
 * un cours absent — retourne un rapport en échec explicite.
 */
export async function runCourseQa(courseId: string): Promise<QaReport> {
  const config = getConfig();
  const checks: QaCheck[] = [];

  const course = await Course.findById(courseId);
  if (!course) {
    return {
      passed: false,
      ranAt: new Date().toISOString(),
      checks: [{ code: 'lessons-complete', ok: false, detail: `Cours introuvable : ${courseId}` }],
    };
  }

  const [sections, lessons, quizzes] = await Promise.all([
    Section.find({ courseId }).sort({ order: 1 }).lean(),
    Lesson.find({ courseId }).sort({ order: 1 }).lean(),
    Quiz.find({ courseId }).lean(),
  ]);

  // ── Check : nombre de sections ─────────────────────────────────────
  const sectionProblem = checkSectionCount(sections.length);
  checks.push({
    code: 'section-count',
    ok: sectionProblem === null,
    detail: sectionProblem ?? `${sections.length} sections.`,
  });

  // ── Check : aucune leçon vide / en échec ───────────────────────────
  const brokenLessons = lessons.filter((l) => l.status !== 'ready');
  checks.push({
    code: 'lessons-complete',
    ok: brokenLessons.length === 0,
    detail:
      brokenLessons.length === 0
        ? `${lessons.length} leçon(s), toutes prêtes.`
        : `${brokenLessons.length} leçon(s) non finalisée(s) : ${brokenLessons
            .map((l) => `« ${l.title} » (${l.status})`)
            .join(', ')}.`,
  });

  // ── Check : vidéos jouables (videoUrl + ffprobe durée > 0 + audio non muet) ──
  const videoLessons = (lessons as LessonForQa[]).filter((l) => l.type === 'video');
  const videoProblems: string[] = [];
  const noiseProblems: string[] = [];
  let totalVideoSeconds = 0;

  for (const lesson of videoLessons) {
    const videoKey = lesson.assets?.videoUrl;
    if (!videoKey) {
      videoProblems.push(`« ${lesson.title} » : aucune vidéo rendue (videoUrl manquant).`);
      // Repli durée : la durée théorique de l'outline compte pour le total en mode mock.
      totalVideoSeconds += (lesson.durationMin ?? 0) * 60;
      continue;
    }

    // Mode mock : on ne sonde pas (aucun média réel), on crédite la durée théorique.
    if (config.MOCK_PROVIDERS) {
      totalVideoSeconds += (lesson.durationMin ?? 0) * 60;
      continue;
    }

    const probe = await probeLessonVideo(videoKey);
    if (!probe) {
      videoProblems.push(`« ${lesson.title} » : vidéo illisible ou introuvable dans le storage.`);
      continue;
    }
    if (probe.durationSec <= 0) {
      videoProblems.push(`« ${lesson.title} » : durée vidéo nulle (média corrompu ?).`);
      continue;
    }
    totalVideoSeconds += probe.durationSec;

    if (!probe.hasAudio) {
      videoProblems.push(`« ${lesson.title} » : la vidéo n'a aucune piste audio.`);
    } else if (probe.meanVolumeDb !== null && probe.meanVolumeDb <= SILENCE_MEAN_VOLUME_DB) {
      videoProblems.push(
        `« ${lesson.title} » : audio quasi silencieux (mean_volume ${probe.meanVolumeDb} dB ≤ ${SILENCE_MEAN_VOLUME_DB} dB).`,
      );
    } else {
      const noiseProblem = checkNoiseFloor(lesson.title, probe.noiseFloorDb);
      if (noiseProblem) noiseProblems.push(noiseProblem);
    }
  }

  checks.push({
    code: 'video-playable',
    ok: videoProblems.length === 0,
    detail:
      videoProblems.length === 0
        ? `${videoLessons.length} vidéo(s) jouable(s) avec audio.`
        : videoProblems.join(' '),
  });

  // ── Check : plancher de bruit de fond (audit qualité voix 2026-07-29) ──
  checks.push({
    code: 'audio-noise-floor',
    ok: noiseProblems.length === 0,
    detail:
      noiseProblems.length === 0
        ? `Plancher de bruit propre (< ${NOISE_FLOOR_DB} dB) sur ${videoLessons.length} vidéo(s).`
        : noiseProblems.join(' '),
  });

  // ── Check : cohérence de l'illustration SDXL par leçon (correctif 1.8) ──
  // Best-effort par design (cf. checkIllustrationConsistency) : on ne sonde
  // que si le pipeline média réel est en jeu (pas en mode mock, où aucun
  // objet S3 n'existe jamais et où le check serait donc vide de sens).
  const illustrationLessons: { title: string; hasIllustration: boolean }[] = [];
  if (!config.MOCK_PROVIDERS) {
    const sectionOrderById = new Map(sections.map((s) => [String(s._id), s.order]));
    for (const lesson of videoLessons) {
      const sectionOrder = sectionOrderById.get(lesson.sectionId.toString());
      if (sectionOrder === undefined) continue;
      const key = storageKeys.course(courseId).lesson(sectionOrder, lesson.order).illustration();
      illustrationLessons.push({ title: lesson.title, hasIllustration: await objectExists(key) });
    }
  }
  const illustrationProblems = checkIllustrationConsistency(illustrationLessons);
  checks.push({
    code: 'illustration-consistency',
    ok: illustrationProblems.length === 0,
    detail:
      illustrationProblems.length === 0
        ? `Illustrations cohérentes (${illustrationLessons.filter((l) => l.hasIllustration).length}/${illustrationLessons.length} vidéo(s)).`
        : illustrationProblems.join(' '),
  });

  // ── Check : durée vidéo totale ─────────────────────────────────────
  const totalVideoMinutes = totalVideoSeconds / 60;
  const durationProblem = checkTotalVideoMinutes(totalVideoMinutes);
  checks.push({
    code: 'video-duration',
    ok: durationProblem === null,
    detail: durationProblem ?? `Durée vidéo totale ${totalVideoMinutes.toFixed(1)} min.`,
  });

  // ── Check : placeholders {{screenshot:}} restants dans les articles ──
  const articleLessons = (lessons as LessonForQa[]).filter((l) => l.type === 'article');
  const articles: { title: string; markdown: string }[] = [];
  for (const lesson of articleLessons) {
    const markdown = await readArticleMarkdown(lesson.assets?.articleMd);
    if (markdown !== null) articles.push({ title: lesson.title, markdown });
  }
  const placeholderProblems = checkArticlePlaceholders(articles);
  checks.push({
    code: 'article-placeholders',
    ok: placeholderProblems.length === 0,
    detail:
      placeholderProblems.length === 0
        ? `${articles.length} article(s) sans placeholder résiduel.`
        : placeholderProblems.join(' '),
  });

  // ── Check : captures de TP réellement exploitables (correctif N2) ──
  const tpLessons = (lessons as LessonForQa[])
    .filter((l) => l.type === 'tp')
    .map((l) => ({
      title: l.title,
      screenshotsCount: l.assets?.screenshots?.length ?? 0,
      degradedCount: l.assets?.screenshotsDegraded?.length ?? 0,
    }));
  const tpProblems = checkTpScreenshots(tpLessons);
  checks.push({
    code: 'screenshots-valid',
    ok: tpProblems.length === 0,
    detail: tpProblems.length === 0 ? `${tpLessons.length} TP avec captures exploitables.` : tpProblems.join(' '),
  });

  // ── Check : quiz valides ───────────────────────────────────────────
  const quizProblems = checkQuizzes(quizzes);
  checks.push({
    code: 'quiz-valid',
    ok: quizProblems.length === 0,
    detail:
      quizProblems.length === 0
        ? `${quizzes.length} quiz valide(s).`
        : quizProblems.join(' '),
  });

  const passed = checks.every((c) => c.ok);
  const report: QaReport = { passed, ranAt: new Date().toISOString(), checks };

  // Persiste le rapport ; le statut ne descend jamais depuis 'published'.
  const nextStatus = passed ? 'ready' : 'failed';
  await Course.updateOne(
    { _id: courseId, status: { $ne: 'published' } },
    { $set: { qaReport: report, status: nextStatus } },
  );
  // Cours déjà publié : on conserve le statut mais on met le rapport à jour.
  await Course.updateOne(
    { _id: courseId, status: 'published' },
    { $set: { qaReport: report } },
  );

  logger.info(
    { courseId, passed, failed: checks.filter((c) => !c.ok).map((c) => c.code) },
    passed ? 'QA cours: succès' : 'QA cours: échec',
  );

  return report;
}
