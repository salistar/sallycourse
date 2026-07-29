// Processor de la queue auxiliaire « audio-repair » (Lot 2, plan 2026-07-20) :
// bouton « Réparer l'audio » d'une leçon vidéo DÉJÀ générée (donc APRÈS
// purge P79 — plus aucun mp3/PNG par slide en S3, cf. retention.ts).
//
// Deux modes :
//   - 'denoise' : passe ffmpeg de nettoyage (débruitage spectral + bornes de
//     fréquence + normalisation) appliquée à la piste audio de la vidéo FINALE,
//     sans re-render ni changement de durée/synchronisation. Répond au « bruit
//     de fond », PAS aux vides (couper du silence désynchroniserait les
//     sous-titres) — rapide (quelques secondes), pas de coût TTS.
//   - 'resynth' : diagnostic ciblé (silencedetect + attribution des trous à
//     leur slide, cf. media/audio-repair.ts — même méthodologie que l'audit
//     manuel du 2026-07-20) puis RE-SYNTHÈSE UNIQUEMENT des slides fautives
//     depuis `Lesson.script.slides[].narration` (jamais purgé), en contournant
//     le cache TTS (sinon on récupère le même mp3 dégénéré déjà en cache —
//     voir doc de `bypassCache` dans media/tts.ts). Ré-enfile video-render en
//     fin de traitement (slides PNG + montage + sous-titres redérivés).
//
// Non checkpointé (contrairement à tts-generation.ts) : le nombre de slides
// concernées est typiquement faible (quelques-unes sur un cours), et
// l'opération est idempotente — un crash en cours de route se corrige
// simplement en relançant la réparation depuis le début (diagnostic +
// resynthèse rejoués, aucun effet de bord cumulatif).
import type { Job } from 'bullmq';
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Course,
  Lesson,
  QUEUES,
  Section,
  User,
  getObjectStream,
  objectExists,
  makeJobId,
  slideScriptSchema,
  storageKeys,
  uploadObject,
  type SlideScript,
  readObjectBuffer,
} from '../shared.js';
import { createQueue, logger } from '../queues/index.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { recordTtsCost } from '../lib/cost.js';
import { probeDurationSeconds, synthesizeSlide, type TtsEngine } from '../media/tts.js';
import { attributeGapsToSlides, computeSlideAudioRanges, parseSilenceDetect } from '../media/audio-repair.js';
import { cleanNarrationAudio, detectCleanupSilences, planAudioCleanup } from '../media/audio-cleanup.js';
import { GARBLED_SIMILARITY_MIN, verifyNarrationAudio } from '../media/narration-verify.js';

export type AudioRepairMode = 'resynth' | 'denoise' | 'switch-voice';

export interface AudioRepairJobData {
  courseId: string;
  lessonId: string;
  mode: AudioRepairMode;
  /**
   * Moteur cible (mode 'switch-voice' uniquement, audit qualité modèles
   * 2026-07-22, additif) — bouton « essayer l'autre voix » à côté de
   * « Réparer l'audio ». Toutes les slides sont re-synthétisées avec ce
   * moteur, sans diagnostic préalable (bascule voulue, pas une réparation).
   */
  targetEngine?: TtsEngine;
}

/** Nom de la queue BullMQ — miroir de apps/web/src/lib/queues.ts (AUDIO_REPAIR_QUEUE). */
export const AUDIO_REPAIR_QUEUE = 'audio-repair';
/** Nom du job — miroir de apps/web/src/lib/queues.ts (AUDIO_REPAIR_JOB). */
export const AUDIO_REPAIR_JOB = 'audio-repair-lesson';

/** jobId déterministe par leçon — identique à `audioRepairJobId` côté web. */
export function audioRepairJobId(lessonId: string): string {
  return `${AUDIO_REPAIR_JOB}_${lessonId}`;
}

export interface AudioRepairResult {
  courseId: string;
  lessonId: string;
  mode: AudioRepairMode;
  gapsFound: number;
  slidesRepaired: number[];
}

/**
 * Seuils silencedetect. Durée minimale relevée de 0,8 s → 1,5 s (constaté en
 * réel le 2026-07-21) : une narration TTS saine contient des pauses naturelles
 * de 0,5-1,2 s entre phrases — à 0,8 s le diagnostic re-flaggait les MÊMES
 * slides saines à chaque exécution (10 « trous » fantômes), donc chaque clic
 * du bouton re-synthétisait et re-rendait pour rien, sans jamais converger
 * vers « aucun problème détecté ». Un vrai dead-air défectueux dure plusieurs
 * secondes : 1,5 s les attrape toujours.
 */
const SILENCE_NOISE_DB = -30;
const SILENCE_MIN_DURATION_SEC = 1.5;

/** Télécharge une clé de stockage vers un fichier local. */
async function downloadToFile(key: string, dest: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of await getObjectStream(key)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await writeFile(dest, Buffer.concat(chunks));
}

// (« stream S3 -> Buffer » factorise dans @sallycourse/shared/storage —
// audit dedup 2026-07-26 : readObjectBuffer/streamToBuffer importes.)

/**
 * Détecte les silences internes d'un fichier audio/vidéo via `ffmpeg
 * silencedetect`. ffmpeg écrit ses logs (dont silence_start/silence_end) sur
 * STDERR même en sortie normale — lu directement sur `execa`, sans dépendre
 * du code de sortie (une commande `-f null` réussie a stderr non vide et
 * exit=0 ; on relit quand même stderr en cas d'échec, par prudence).
 */
async function detectSilenceGaps(file: string): Promise<ReturnType<typeof parseSilenceDetect>> {
  try {
    const { stderr } = await execa('ffmpeg', [
      '-i',
      file,
      '-af',
      `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION_SEC}`,
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ]);
    return parseSilenceDetect(stderr);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    if (stderr) return parseSilenceDetect(stderr);
    throw err;
  }
}

/** Persiste un échec (best-effort — ne jette jamais, appelé depuis un catch). */
async function markFailed(lessonId: string, mode: AudioRepairMode, message: string): Promise<void> {
  try {
    await Lesson.updateOne(
      { _id: lessonId },
      {
        $set: {
          'assets.audioRepairStatus': 'failed',
          'assets.audioRepairReport': { mode, ranAt: new Date(), error: message },
        },
      },
    );
  } catch (err) {
    logger.warn({ lessonId, err }, 'audio-repair : impossible de persister le statut d’échec');
  }
}

/** Processor de la queue « audio-repair » (un job = une leçon, un mode). */
export async function processAudioRepair(job: Job<AudioRepairJobData>): Promise<AudioRepairResult> {
  const { courseId, lessonId, mode, targetEngine } = job.data;
  const isSwitchVoice = mode === 'switch-voice';
  if (isSwitchVoice && !targetEngine) {
    throw new Error(`audio-repair (switch-voice) : targetEngine manquant pour la leçon ${lessonId}`);
  }

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
  if (lesson.type !== 'video') {
    throw new Error(`audio-repair : leçon ${lessonId} de type « ${lesson.type} » (attendu : video)`);
  }
  const videoKey = lesson.assets?.videoUrl;
  if (!videoKey) throw new Error(`audio-repair : leçon ${lessonId} sans vidéo rendue`);

  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);
  const section = await Section.findById(lesson.sectionId);
  if (!section) throw new Error(`section introuvable pour la leçon ${lessonId}`);

  lesson.assets.audioRepairStatus = 'running';
  await lesson.save().catch(() => undefined);

  const dir = await mkdtemp(path.join(tmpdir(), 'audio-repair-'));
  try {
    const localVideo = path.join(dir, 'video.mp4');
    await downloadToFile(videoKey, localVideo);

    if (mode === 'denoise') {
      const output = path.join(dir, 'repaired.mp4');
      // Débruitage spectral (afftdn) + bornes de fréquence (voix humaine
      // ~80Hz-12kHz) + renormalisation loudness — vidéo copiée telle quelle
      // (-c:v copy), AUCUN changement de durée/timing (donc sous-titres
      // inchangés, pas de re-render nécessaire).
      await execa('ffmpeg', [
        '-y',
        '-i',
        localVideo,
        '-af',
        'afftdn=nf=-25,highpass=f=80,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=11',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        output,
      ]);
      await uploadObject(videoKey, await readFile(output), 'video/mp4');

      lesson.assets.audioRepairStatus = 'ready';
      lesson.assets.audioRepairReport = { mode: 'denoise', ranAt: new Date() };
      await lesson.save();
      logger.info({ courseId, lessonId }, 'audio-repair (denoise) terminé');
      return { courseId, lessonId, mode, gapsFound: 0, slidesRepaired: [] };
    }

    // ── modes 'resynth' et 'switch-voice' ──────────────────────────────
    const parsed = slideScriptSchema.safeParse(lesson.script);
    if (!parsed.success) {
      throw new Error(`script vidéo absent ou invalide pour la leçon ${lessonId}`);
    }
    const script: SlideScript = parsed.data;

    // 'switch-voice' est une BASCULE voulue par l'auteur, pas un diagnostic de
    // défaut — toutes les slides sont re-synthétisées avec le nouveau moteur,
    // sans passer par silencedetect/burst (coût GPU inutile, et surtout : un
    // audio parfaitement sain avec l'ancien moteur ne doit pas être exclu).
    const gaps = isSwitchVoice ? [] : await detectSilenceGaps(localVideo);
    const ranges = computeSlideAudioRanges(script.slides);
    const flaggedIndices = isSwitchVoice ? [] : attributeGapsToSlides(gaps, ranges);

    // Passe FINE complémentaire (constaté en réel 2026-07-21) : une
    // MICRO-RAFALE parasite (< 200 ms de bruit isolé entre deux pauses) est
    // inaudible pour silencedetect au seuil leçon mais très audible à
    // l'oreille. On la détecte sur la piste de la vidéo et on flagge la slide
    // qui la contient — sa resynthèse passera par le nettoyage DSP de
    // media/audio-cleanup.ts qui neutralise ce motif.
    const burstFlags: number[] = [];
    if (!isSwitchVoice) {
      const fineSilences = await detectCleanupSilences(localVideo);
      const finePlan = planAudioCleanup(fineSilences, ranges.length > 0 ? ranges[ranges.length - 1]!.end : 0);
      for (const burst of finePlan.mutes) {
        const mid = (burst.start + burst.end) / 2;
        const hit = ranges.findIndex((r) => mid > r.start + 0.3 && mid < r.end - 0.3);
        if (hit >= 0 && !burstFlags.includes(hit)) burstFlags.push(hit);
      }
      if (burstFlags.length > 0) {
        logger.info({ courseId, lessonId, burstFlags }, 'audio-repair : micro-rafales parasites détectées');
      }
    }

    const lessonKeys = storageKeys.course(courseId).lesson(section.order, lesson.order);

    // Moteur de voix effectif pour cette exécution (audit qualité modèles
    // 2026-07-22, additif) : 'switch-voice' impose le moteur cible du bouton ;
    // 'resynth' garde le moteur ACTUEL de la leçon (bascule antérieure ou
    // défaut du cours) — une réparation ne doit jamais changer de moteur
    // silencieusement, seul le bouton dédié le fait.
    const engineForRepair: TtsEngine = isSwitchVoice
      ? targetEngine!
      : ((lesson.assets?.ttsEngine ?? course.ttsEngine ?? 'chatterbox') as TtsEngine);

    // PIÈGE PURGE P79 (retention.ts) : après 'ready', TOUS les audio/{i}.mp3
    // sont supprimés de S3 — pas seulement ceux des slides fautives. Le
    // re-render final relit audio(i) pour CHAQUE slide et remplace tout mp3
    // manquant par du silence (video-render.ts, okAudio ? path : null). Sans
    // cette passe, réparer les slides 1-3 rendait donc les slides 0 et 4
    // MUETTES dans la vidéo réparée (constaté en réel : 45 s de silence).
    // → toute slide dont l'audio a été purgé est re-produite aussi ; SANS
    // bypassCache pour elles (le cache TTS content-based restitue l'audio
    // d'origine à l'identique, gratuitement) — bypassCache reste réservé aux
    // slides FAUTIVES (leur audio en cache est précisément le dégénéré).
    const flaggedSet = new Set([...flaggedIndices, ...burstFlags]);
    const missingSet = new Set<number>();
    for (let i = 0; i < script.slides.length; i += 1) {
      if (!(await objectExists(lessonKeys.audio(i)))) missingSet.add(i);
    }
    // 'switch-voice' : TOUTES les slides, quel que soit leur état — c'est une
    // bascule de moteur voulue, pas une réparation ciblée.
    const toProcess = isSwitchVoice
      ? script.slides.map((_, i) => i)
      : Array.from(new Set([...flaggedSet, ...missingSet])).sort((a, b) => a - b);

    const locale = course.locale;
    const voice = course.ttsVoice;
    const narrationSpeed = course.narrationSpeed;
    const plan = await planForCourse(courseId);

    // Voix clonée (Chatterbox/Modal) — même résolution que tts-generation.ts,
    // pour que la réparation produise une voix cohérente avec le reste de la
    // leçon si le cours utilise une voix personnalisée.
    let voiceSampleB64: string | undefined;
    let voiceSampleId: string | undefined;
    if (course.useCustomVoice) {
      const owner = await User.findById(course.userId).select('voiceSampleUploadedAt voiceCloneConsent').lean();
      if (owner?.voiceSampleUploadedAt && owner.voiceCloneConsent) {
        try {
          const sampleKey = storageKeys.voiceSample(String(course.userId));
          voiceSampleB64 = (await readObjectBuffer(sampleKey)).toString('base64');
          voiceSampleId = `${String(course.userId)}:${new Date(owner.voiceSampleUploadedAt).getTime()}`;
        } catch (err) {
          logger.warn({ courseId, lessonId, err }, 'voix clonée : échantillon introuvable — voix standard pour la réparation');
        }
      }
    }

    for (const index of toProcess) {
      const slide = script.slides[index];
      if (!slide) continue;
      const audioKey = lessonKeys.audio(index);
      // bypassCache UNIQUEMENT pour une slide FAUTIVE dont l'audio existe
      // encore (là, le cache contient précisément le mp3 dégénéré qu'on
      // répare) OU en mode 'switch-voice' (on FORCE le nouveau moteur, le
      // cache de l'ancien moteur ne doit jamais être resservi). Pour un audio
      // simplement PURGÉ (P79) en mode 'resynth', le hit de cache restitue
      // l'original à l'identique — gratuit et correct.
      const defective = isSwitchVoice || (flaggedSet.has(index) && !missingSet.has(index));
      const res = await synthesizeSlide({
        text: slide.narration,
        locale,
        voice,
        speed: narrationSpeed,
        plan,
        voiceSampleB64,
        voiceSampleId,
        ttsEngine: engineForRepair,
        context: `${courseId}:${lessonId}:slide${index}:repair`,
        bypassCache: defective,
      });
      // Nettoyage DSP systématique AVANT upload (micro-rafales + silences
      // intérieurs trop longs — voir media/audio-cleanup.ts) : la sortie TTS
      // étant déterministe, resynthétiser ne suffit pas à faire disparaître
      // un artefact vocal du modèle ; le nettoyage, si.
      const rawSlidePath = path.join(dir, `repair-${index}-raw.mp3`);
      const cleanSlidePath = path.join(dir, `repair-${index}-clean.mp3`);
      await writeFile(rawSlidePath, await readObjectBuffer(res.cacheKey));
      const cleaned = await cleanNarrationAudio(rawSlidePath, cleanSlidePath, res.seconds);
      const finalPath = cleaned ? cleanSlidePath : rawSlidePath;
      const finalSeconds = cleaned ? await probeDurationSeconds(finalPath) : res.seconds;
      await uploadObject(audioKey, await readFile(finalPath), 'audio/mpeg');
      slide.audioKey = audioKey;
      slide.audioSeconds = finalSeconds;
      if (res.provider !== 'cache') {
        await recordTtsCost(
          { courseId, userId: String(course.userId) },
          slide.narration.length,
          res.provider,
          res.durationMs,
        ).catch(() => undefined);
      }
      logger.info(
        { courseId, lessonId, index, provider: res.provider, seconds: res.seconds, defective },
        defective ? 'audio-repair : slide re-synthétisée' : 'audio-repair : audio purgé restauré',
      );
    }

    // ── Vérification d'INTELLIGIBILITÉ (Whisper) de TOUTES les slides ─────
    // Un segment dégénéré (voix qui change de timbre, mots inarticulés —
    // constaté en réel le 2026-07-21) n'a souvent AUCUNE signature signal :
    // ni trou, ni rafale, énergie normale. Seule la transcription le trahit.
    // Et comme la sortie du provider premium est DÉTERMINISTE (même texte →
    // même audio, défaut compris), re-synthétiser chez lui ne corrige rien :
    // on ESCALADE vers le provider suivant de la cascade (modal → edge…) et
    // on ne garde l'alternative que si sa similarité est meilleure.
    const escalated: number[] = [];
    for (let index = 0; index < script.slides.length; index += 1) {
      const slide = script.slides[index];
      if (!slide) continue;
      const audioKey = lessonKeys.audio(index);
      const checkPath = path.join(dir, `verify-${index}.mp3`);
      try {
        await writeFile(checkPath, await readObjectBuffer(audioKey));
      } catch {
        continue;
      }
      const current = await verifyNarrationAudio(checkPath, slide.narration, locale);
      if (!current) break; // Whisper non configuré/indisponible — vérification sautée (best-effort).
      if (current.similarity >= GARBLED_SIMILARITY_MIN) continue;
      logger.warn(
        { courseId, lessonId, index, similarity: current.similarity, transcript: current.transcript.slice(0, 120) },
        'audio-repair : slide inintelligible (Whisper) — escalade de provider',
      );
      const alt = await synthesizeSlide({
        text: slide.narration,
        locale,
        voice,
        speed: narrationSpeed,
        plan,
        voiceSampleB64,
        voiceSampleId,
        ttsEngine: engineForRepair,
        context: `${courseId}:${lessonId}:slide${index}:repair-escalade`,
        bypassCache: true,
        // Exclut le moteur EFFECTIVEMENT utilisé pour cette exécution (pas
        // toujours 'modal' depuis l'ajout Qwen3-TTS 2026-07-22) : sortie
        // déterministe, ré-essayer chez lui reproduirait le même défaut.
        excludeProviders: [engineForRepair === 'qwen3' ? 'qwen3' : 'modal'],
      });
      const altRaw = path.join(dir, `verify-${index}-alt.mp3`);
      const altClean = path.join(dir, `verify-${index}-alt-clean.mp3`);
      await writeFile(altRaw, await readObjectBuffer(alt.cacheKey));
      const altCleaned = await cleanNarrationAudio(altRaw, altClean, alt.seconds);
      const altPath = altCleaned ? altClean : altRaw;
      const altVerif = await verifyNarrationAudio(altPath, slide.narration, locale);
      if (altVerif && altVerif.similarity > current.similarity) {
        const altSeconds = await probeDurationSeconds(altPath);
        await uploadObject(audioKey, await readFile(altPath), 'audio/mpeg');
        slide.audioKey = audioKey;
        slide.audioSeconds = altSeconds;
        if (alt.provider !== 'cache') {
          await recordTtsCost(
            { courseId, userId: String(course.userId) },
            slide.narration.length,
            alt.provider,
            alt.durationMs,
          ).catch(() => undefined);
        }
        escalated.push(index);
        logger.info(
          { courseId, lessonId, index, provider: alt.provider, from: current.similarity, to: altVerif.similarity },
          'audio-repair : slide remplacée par le provider de repli (plus intelligible)',
        );
      } else {
        logger.warn(
          { courseId, lessonId, index, current: current.similarity, alt: altVerif?.similarity },
          'audio-repair : escalade sans gain de similarité — audio conservé',
        );
      }
    }

    const slidesRepaired = Array.from(new Set([...toProcess, ...escalated])).sort((a, b) => a - b);

    lesson.script = script;
    lesson.markModified('script');
    lesson.assets.audioRepairStatus = 'ready';
    lesson.assets.audioRepairReport = {
      mode,
      ranAt: new Date(),
      gapsFound: gaps.length,
      slidesRepaired,
      ...(isSwitchVoice ? { targetEngine: engineForRepair } : {}),
    };
    // Le bouton « switch » a réussi : CETTE leçon narre désormais avec le
    // nouveau moteur — sert de base à la prochaine réparation/bascule.
    if (isSwitchVoice) lesson.assets.ttsEngine = engineForRepair;
    await lesson.save();

    // Re-render SYSTÉMATIQUE (même sans slide re-produite) : l'auteur a cliqué
    // parce qu'il ENTEND un défaut — souvent un artefact d'assemblage que le
    // ré-assemblage (micro-fondus de buildLessonAudioArgs) suffit à effacer,
    // sans coût TTS. Un clic du bouton produit TOUJOURS une vidéo ré-assemblée
    // avec le pipeline le plus récent. Même dédup que tts-generation.ts.
    const renderQueue = createQueue(QUEUES.videoRender);
    const renderJobId = makeJobId(courseId, QUEUES.videoRender, lessonId);
    await renderQueue.remove(renderJobId).catch(() => undefined);
    await renderQueue.add(QUEUES.videoRender, { courseId, lessonId }, { jobId: renderJobId });

    logger.info(
      { courseId, lessonId, slidesRepaired },
      'audio-repair (resynth) terminé, video-render enfilé',
    );
    return { courseId, lessonId, mode, gapsFound: gaps.length, slidesRepaired };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, mode, err }, 'échec de la réparation audio');
    await markFailed(lessonId, mode, message);
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
