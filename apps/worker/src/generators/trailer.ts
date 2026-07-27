// Générateur de BANDE-ANNONCE (Prompt 197) : produit un trailer de 60-90 s par
// cours — obligatoire sur Udemy, décisif pour la conversion.
//
// Réutilise tout l'existant, sans nouvel asset : script d'accroche généré par le
// LLM (problème → promesse → aperçu du programme → CTA), narré par le TTS du
// cours (même voix, y compris clonée), monté sur les SLIDES déjà rendues (PNG)
// avec fondus, à la durée exacte de la narration. Best-effort : un échec
// n'invalide jamais la finalisation du cours.
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  AUDIO,
  Course,
  Lesson,
  Section,
  VIDEO,
  getObjectStream,
  objectExists,
  slideScriptSchema,
  storageKeys,
  uploadObject,
} from '../shared.js';
import { callClaudeJson } from '../lib/claude.js';
import { synthesizeSlide } from '../media/tts.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { logger } from '../queues/index.js';

/** Nombre d'images du montage (visuels pris parmi les slides du cours). */
const MAX_SHOTS = 8;
/** Durée minimale d'un plan (s) — évite un diaporama épileptique. */
const MIN_SHOT_SECONDS = 2;

/** Script de bande-annonce généré par le LLM. */
export const trailerScriptSchema = z.object({
  /** Narration continue de 60-90 s (≈150-230 mots) : accroche → promesse → programme → CTA. */
  narration: z.string().min(120).max(1500),
});

/** Télécharge une clé dans un fichier local. */
async function downloadTo(key: string, dest: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of await getObjectStream(key)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await writeFile(dest, Buffer.concat(chunks));
}

/**
 * Arguments ffmpeg d'un PLAN : une image tenue `seconds`, mise au format vidéo,
 * avec fondu d'entrée/sortie. Fonction PURE (testable).
 */
export function buildShotArgs(imagePath: string, dest: string, seconds: number): string[] {
  const d = Math.max(MIN_SHOT_SECONDS, seconds);
  const fadeOut = Math.max(0, d - 0.4);
  return [
    '-y',
    '-loop',
    '1',
    '-i',
    imagePath,
    '-t',
    d.toFixed(3),
    '-vf',
    `scale=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${VIDEO.WIDTH}:${VIDEO.HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
      `fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.4,format=yuv420p`,
    '-r',
    String(VIDEO.FPS),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '21',
    dest,
  ];
}

/** Sélectionne jusqu'à MAX_SHOTS clés de slides réparties sur tout le cours. */
export function pickShotKeys(allSlideKeys: string[], max = MAX_SHOTS): string[] {
  if (allSlideKeys.length <= max) return allSlideKeys;
  const step = allSlideKeys.length / max;
  return Array.from({ length: max }, (_, i) => allSlideKeys[Math.floor(i * step)]!);
}

/**
 * Plan de montage : quelles slides, et combien de temps chacune.
 *
 * Le nombre de plans est borné par `narrationSec / MIN_SHOT_SECONDS`, de sorte
 * que `perShot` ne tombe JAMAIS sous le plancher. Sans cette borne, le plancher
 * rallongerait le montage au-delà de la narration et le `-shortest` du mux
 * couperait la fin de la vidéo (derniers plans + fondu de sortie perdus).
 * Invariant garanti : `shots.length * perShot === narrationSec`. PURE.
 */
export function planTrailerShots(
  slideKeys: string[],
  narrationSec: number,
): { shots: string[]; perShot: number } {
  const maxShots = Math.max(1, Math.min(MAX_SHOTS, Math.floor(narrationSec / MIN_SHOT_SECONDS)));
  const shots = pickShotKeys(slideKeys, maxShots);
  return { shots, perShot: narrationSec / shots.length };
}

/** Génère la bande-annonce et pose Course.repurposing.trailer. Jette en cas d'échec. */
export async function generateCourseTrailer(courseId: string): Promise<{ seconds: number; shots: number }> {
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  // 1) Visuels : les slides DÉJÀ rendues, réparties sur tout le cours.
  const sections = await Section.find({ courseId }).sort({ order: 1 }).lean();
  const slideKeys: string[] = [];
  for (const section of sections) {
    const lessons = await Lesson.find({ sectionId: section._id, type: 'video' }).sort({ order: 1 }).lean();
    for (const lesson of lessons) {
      const parsed = slideScriptSchema.safeParse(lesson.script);
      if (!parsed.success) continue;
      const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);
      // Une slide par leçon suffit (la 1re, la plus « titre »).
      const k = keys.slide(0);
      if (await objectExists(k)) slideKeys.push(k);
    }
  }
  if (slideKeys.length === 0) throw new Error('aucune slide rendue — bande-annonce impossible');

  // 2) Script d'accroche (LLM) — structure de trailer qui convertit.
  const outline = sections.map((s) => `- ${s.title}`).join('\n');
  const script = await callClaudeJson({
    schema: trailerScriptSchema,
    system:
      `Tu écris des bandes-annonces de cours en ligne qui CONVERTISSENT. Structure imposée : ` +
      `(1) accroche sur le PROBLÈME de l'apprenant, (2) PROMESSE concrète, (3) aperçu du PROGRAMME, ` +
      `(4) appel à l'action. Ton dynamique, phrases courtes, à la 2e personne. 150 à 220 mots MAXIMUM ` +
      `(soit 60-90 secondes de narration). Écris dans la langue du cours.`,
    user:
      `Cours : « ${course.title} » (niveau ${course.difficulty}, langue ${course.locale}).\n` +
      `Programme :\n${outline}\n\n` +
      `Réponds UNIQUEMENT en JSON : { "narration": string }.`,
    maxTokens: 1500,
    cost: { courseId, userId: String(course.userId) },
    llmProviderId: course.llmProvider,
  });

  const dir = await mkdtemp(path.join(tmpdir(), 'trailer-'));
  try {
    // 3) Narration : même voix que le cours (clonée incluse via Course.ttsVoice).
    const plan = await planForCourse(courseId);
    const { cacheKey } = await synthesizeSlide({
      text: script.narration,
      locale: course.locale,
      voice: course.ttsVoice,
      speed: course.narrationSpeed,
      plan,
    });
    const audioPath = path.join(dir, 'narration.mp3');
    await downloadTo(cacheKey, audioPath);
    const { stdout } = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);
    const narrationSec = Math.max(10, Number.parseFloat(stdout.trim()) || 60);

    // 4) Montage : plans choisis APRÈS la mesure de la narration (cf.
    // planTrailerShots — le montage dure exactement la durée de la narration).
    const { shots, perShot } = planTrailerShots(slideKeys, narrationSec);
    const shotFiles: string[] = [];
    for (let i = 0; i < shots.length; i += 1) {
      const img = path.join(dir, `shot-${i}.png`);
      await downloadTo(shots[i]!, img);
      const seg = path.join(dir, `shot-${i}.mp4`);
      await execa('ffmpeg', buildShotArgs(img, seg, perShot));
      shotFiles.push(seg);
    }
    const listPath = path.join(dir, 'list.txt');
    await writeFile(listPath, shotFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const silent = path.join(dir, 'silent.mp4');
    await execa('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', silent]);

    // 5) Mux de la narration (durée calée sur le plus court des deux flux).
    const out = path.join(dir, 'trailer.mp4');
    await execa('ffmpeg', [
      '-y',
      '-i',
      silent,
      '-i',
      audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ar',
      String(AUDIO.SAMPLE_RATE),
      '-movflags',
      '+faststart',
      '-shortest',
      out,
    ]);

    const keys = storageKeys.course(courseId);
    const videoKey = keys.trailer();
    await uploadObject(videoKey, await readFile(out), 'video/mp4');
    await Course.updateOne({ _id: courseId }, { $set: { 'repurposing.trailer': { videoKey } } });

    logger.info({ courseId, seconds: Math.round(narrationSec), shots: shots.length }, 'bande-annonce générée');
    return { seconds: Math.round(narrationSec), shots: shots.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Variante best-effort (jamais fatale) pour la finalisation du cours. */
export async function generateCourseTrailerBestEffort(courseId: string): Promise<void> {
  try {
    await generateCourseTrailer(courseId);
  } catch (err) {
    logger.warn({ courseId, err }, 'génération de la bande-annonce échouée — ignorée (best-effort)');
  }
}
