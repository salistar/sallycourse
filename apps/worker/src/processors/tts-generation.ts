// Processor BullMQ « tts-generation » : pour chaque slide du script vidéo d'une
// leçon, synthétise la narration en mp3 normalisé (media/tts.ts), l'uploade sous
// storageKeys…audio(i), et enregistre audioKey + audioSeconds sur la slide. Puis
// enfile video-render pour la leçon. Publie la progression et gère le statut.
import type { Job } from 'bullmq';
import {
  Course,
  Lesson,
  QUEUES,
  Section,
  User,
  getObjectStream,
  makeJobId,
  notify,
  publishProgress,
  slideScriptSchema,
  storageKeys,
  ttsVoiceForMode,
  uploadObject,
  type SlideScript,
  type TtsJobData,
  readObjectBuffer,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { priorityForPlan } from '../queues/priority.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { synthesizeSlide, type TtsEngine, type TtsProvider } from '../media/tts.js';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { getCatalogVoice, resolveCatalogVoice } from '@sallycourse/shared';
import { getCatalogVoiceSampleB64 } from '../media/voice-samples.js';
import { recordTtsCost } from '../lib/cost.js';
import { mongoCheckpointStore, withCheckpoint } from '../lib/idempotency.js';
import { CourseCancelledError, checkCancelled } from '../lib/cancellation.js';
import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface TtsResult {
  courseId: string;
  lessonId: string;
  slides: number;
  totalSeconds: number;
}

/** Publie la progression du step tts-generation (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.tts,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
}

/**
 * Copie un objet storage vers la clé audio définitive de la slide — source
 * générique (cache TTS OU enregistrement manuel normalisé, Lot 4, plan
 * 2026-07-20 : voir l'appel `slide.manualAudioKey` dans `runStep` ci-dessous).
 */
async function copyObjectToLessonAudio(sourceKey: string, audioKey: string): Promise<void> {
  if (sourceKey === audioKey) return;
  const stream = await getObjectStream(sourceKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await uploadObject(audioKey, Buffer.concat(chunks), 'audio/mpeg');
}

// (« stream S3 -> Buffer » factorise dans @sallycourse/shared/storage —
// audit dedup 2026-07-26 : readObjectBuffer/streamToBuffer importes.)

/** Un tour de parole d'un dialogue (P169). */
interface DialogueTurn {
  role: 'instructor' | 'learner';
  text: string;
}

/**
 * Découpe une narration balisée « [Formateur] … [Apprenant] … » en tours de
 * parole (P169). Retourne null si moins de 2 tours (⇒ pas un vrai dialogue :
 * on retombe sur la synthèse mono-voix standard). Les balises ne sont JAMAIS
 * narrées (elles servent uniquement au découpage + au choix de la voix).
 */
export function parseDialogueTurns(narration: string): DialogueTurn[] | null {
  const re = /\[(Formateur|Apprenant)\]\s*([\s\S]*?)(?=\[(?:Formateur|Apprenant)\]|$)/g;
  const turns: DialogueTurn[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(narration)) !== null) {
    const text = (m[2] ?? '').trim();
    if (text) turns.push({ role: m[1] === 'Apprenant' ? 'learner' : 'instructor', text });
  }
  return turns.length >= 2 ? turns : null;
}

/** Paramètres communs de synthèse (partagés entre mono-voix et dialogue). */
interface SynthParams {
  locale: string;
  voice?: string;
  secondVoice?: string;
  speed?: number;
  plan: string;
  voiceSampleB64?: string;
  voiceSampleId?: string;
  /** Moteur de voix premium préféré (Course.ttsEngine, audit 2026-07-22, additif). */
  ttsEngine?: TtsEngine;
  /** Voix Edge source de la voix du cours (catalogue, fix « voix multiples »). */
  edgeVoice?: string;
  /** Voix Edge source de la seconde voix (apprenant, dialogue P169). */
  secondEdgeVoice?: string;
  /** Échantillon catalogue de la seconde voix (épinglage apprenant sur les moteurs premium). */
  secondVoiceSampleB64?: string;
  secondVoiceSampleId?: string;
}

/**
 * Synthèse d'une slide en DIALOGUE bi-voix (P169) : chaque tour de parole est
 * synthétisé avec sa voix (formateur = voix du cours, apprenant = secondVoice),
 * puis les segments sont concaténés en un seul MP3 uploadé sur `audioKey`.
 * Retourne la durée totale. Jette en cas d'échec — l'appelant retombe alors sur
 * la synthèse mono-voix (balises retirées).
 */
async function synthesizeDialogueSlide(
  turns: DialogueTurn[],
  audioKey: string,
  p: SynthParams,
): Promise<{ seconds: number; provider: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tts-dialogue-'));
  try {
    const segFiles: string[] = [];
    let lastProvider = 'mock';
    for (let i = 0; i < turns.length; i += 1) {
      const turn = turns[i]!;
      const turnVoice = turn.role === 'learner' ? p.secondVoice ?? p.voice : p.voice;
      // Identité épinglée par rôle (fix « voix multiples ») : le formateur garde
      // la voix du cours, l'apprenant sa seconde voix — sur TOUS les moteurs.
      const turnEdgeVoice = turn.role === 'learner' ? p.secondEdgeVoice ?? p.edgeVoice : p.edgeVoice;
      const { cacheKey, provider } = await synthesizeSlide({
        text: turn.text,
        locale: p.locale,
        voice: turnVoice,
        speed: p.speed,
        plan: p.plan,
        ttsEngine: p.ttsEngine,
        edgeVoice: turnEdgeVoice,
        // Clonage par rôle : formateur = voix du cours (auteur ou catalogue) ;
        // apprenant = échantillon catalogue de la seconde voix (fix « voix
        // multiples » : sans lui, les moteurs premium liraient l'apprenant
        // avec leur timbre par défaut, différent de la voix Edge de repli).
        ...(turn.role === 'instructor' && p.voiceSampleB64
          ? { voiceSampleB64: p.voiceSampleB64, voiceSampleId: p.voiceSampleId }
          : {}),
        ...(turn.role === 'learner' && p.secondVoiceSampleB64
          ? { voiceSampleB64: p.secondVoiceSampleB64, voiceSampleId: p.secondVoiceSampleId }
          : {}),
      });
      lastProvider = provider;
      const segPath = path.join(dir, `seg-${i}.mp3`);
      await writeFile(segPath, await readObjectBuffer(cacheKey));
      segFiles.push(segPath);
    }
    // Concat des segments (ré-encodage MP3 : robuste aux en-têtes hétérogènes).
    const listPath = path.join(dir, 'list.txt');
    await writeFile(listPath, segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const outPath = path.join(dir, 'dialogue.mp3');
    await execa('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-q:a', '4', outPath]);
    const { stdout } = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      outPath,
    ]);
    const seconds = Number.parseFloat(stdout.trim()) || 0;
    await uploadObject(audioKey, await readFile(outPath), 'audio/mpeg');
    return { seconds, provider: `dialogue:${lastProvider}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Synthétise la narration de toutes les slides d'une leçon vidéo, persiste les
 * clés/durées audio sur Lesson.script, puis enfile video-render. Jette en cas
 * d'échec (le worker BullMQ gère alors les retentatives + marquage GenerationJob).
 */
export async function processTtsGeneration(job: Job<TtsJobData>): Promise<TtsResult> {
  const { courseId, lessonId, mode } = job.data;

  try {
    await report(courseId, 5, 'Chargement de la leçon pour la synthèse vocale');
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);
    if (lesson.type !== 'video') {
      throw new Error(`tts-generation : leçon ${lessonId} de type « ${lesson.type} » (attendu : video)`);
    }

    const parsed = slideScriptSchema.safeParse(lesson.script);
    if (!parsed.success) {
      throw new Error(`script vidéo absent ou invalide pour la leçon ${lessonId} — lancez d'abord la génération de contenu`);
    }
    const script: SlideScript = parsed.data;

    const course = await Course.findById(courseId);
    if (!course) throw new Error(`cours introuvable : ${courseId}`);
    const section = await Section.findById(lesson.sectionId);
    if (!section) throw new Error(`section introuvable pour la leçon ${lessonId}`);

    const lessonKeys = storageKeys.course(courseId).lesson(section.order, lesson.order);
    const locale = course.locale;
    // Aperçu rapide (P133) : voix standard par langue FORCÉE (jamais de voix
    // clonée) — la voix la plus rapide/économique à générer, adaptée à un
    // brouillon jetable. En mode 'final' (ou absent) : voix du cours inchangée.
    const voice = ttsVoiceForMode(mode ?? 'final', course.ttsVoice);
    // Vitesse de narration configurable (P137, accessibilité) — undefined → 1
    // (débit standard, comportement inchangé pour les cours existants).
    const narrationSpeed = course.narrationSpeed;
    // Moteur de voix premium préféré (audit qualité modèles 2026-07-22, additif) —
    // absent = 'chatterbox' (comportement inchangé). Voir Course.ttsEngine.
    const ttsEngine: TtsEngine | undefined = course.ttsEngine;
    // Plan du propriétaire (P153) : ElevenLabs est une option PREMIUM — le plan
    // réel est connu ici (via planForCourse), donc on l'indique explicitement
    // à synthesizeSlide pour activer la vérification (free → Piper/Kokoro only).
    const plan = await planForCourse(courseId);

    // Dialogue multi-voix (P169) : narration en dialogue formateur/apprenant lue
    // par deux voix. Jamais en aperçu rapide (voix standard forcée).
    const dialogueMode = Boolean(course.advancedParams?.dialogueMode) && mode !== 'quick-preview';
    const secondVoice = course.advancedParams?.dialogueSecondVoice;

    // ── Voix du catalogue (fix « voix multiples » 2026-07-26) ────────────────
    // L'identité vocale du cours est ÉPINGLÉE : Course.voiceId (ou le défaut de
    // la langue) désigne une voix Edge source ; son échantillon de référence
    // sert de prompt de clonage aux moteurs premium, et le repli Edge utilise
    // la voix source elle-même → même timbre sur toutes les slides et toutes
    // les leçons, quel que soit le moteur réellement utilisé par la cascade.
    const catalogVoice = resolveCatalogVoice(course.voiceId, locale);
    const edgeVoice = catalogVoice.edgeVoice;
    const secondCatalogVoice = getCatalogVoice(secondVoice);
    const secondEdgeVoice = secondCatalogVoice?.edgeVoice;

    // Voix clonée personnalisée (Chatterbox/Modal) : si le cours l'active
    // (useCustomVoice) et que le propriétaire a un échantillon prêt + a consenti,
    // on charge l'échantillon UNE fois (pas par slide) et on le transmet à
    // synthesizeSlide (audio_prompt Modal). Jamais en aperçu rapide (draft).
    let voiceSampleB64: string | undefined;
    let voiceSampleId: string | undefined;
    if (course.useCustomVoice && mode !== 'quick-preview') {
      const owner = await User.findById(course.userId)
        .select('voiceSampleUploadedAt voiceCloneConsent')
        .lean();
      if (owner?.voiceSampleUploadedAt && owner.voiceCloneConsent) {
        try {
          const sampleKey = storageKeys.voiceSample(String(course.userId));
          const chunks: Buffer[] = [];
          for await (const chunk of await getObjectStream(sampleKey)) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          voiceSampleB64 = Buffer.concat(chunks).toString('base64');
          voiceSampleId = `${String(course.userId)}:${new Date(owner.voiceSampleUploadedAt).getTime()}`;
          logger.info({ courseId, lessonId }, 'voix clonée : échantillon chargé pour la narration');
        } catch (err) {
          logger.warn({ courseId, lessonId, err }, 'voix clonée : échantillon introuvable — voix standard');
        }
      }
    }

    // Épinglage catalogue (fix « voix multiples ») : sans voix clonée de
    // l'auteur, l'échantillon de la voix du catalogue devient le prompt de
    // clonage des moteurs premium — même identité que le repli Edge. Jamais en
    // aperçu rapide (latence inutile pour un brouillon jetable). Best-effort :
    // échantillon indisponible → narration comme avant ce correctif.
    if (!voiceSampleB64 && mode !== 'quick-preview') {
      const sample = await getCatalogVoiceSampleB64(catalogVoice);
      if (sample) {
        voiceSampleB64 = sample;
        voiceSampleId = `catalog:${catalogVoice.id}`;
      }
    }
    // Échantillon de la seconde voix (dialogue P169) — même logique, apprenant.
    let secondVoiceSampleB64: string | undefined;
    let secondVoiceSampleId: string | undefined;
    if (dialogueMode && secondCatalogVoice) {
      const sample = await getCatalogVoiceSampleB64(secondCatalogVoice);
      if (sample) {
        secondVoiceSampleB64 = sample;
        secondVoiceSampleId = `catalog:${secondCatalogVoice.id}`;
      }
    }

    // Traçabilité voix clonée (P81) : si la voix utilisée est la voix clonée du
    // propriétaire du cours, on logue l'usage via une Notification interne
    // (watermark = log de conformité, pas de tatouage audio — voir voice-clone.ts).
    // Best-effort, une seule fois par leçon (pas par slide). Ignoré en mode
    // aperçu rapide : la voix clonée n'est jamais utilisée dans ce mode.
    if (voice) {
      const owner = await User.findById(course.userId).select('clonedVoiceId').lean();
      if (owner?.clonedVoiceId && owner.clonedVoiceId === voice) {
        await notify(String(course.userId), {
          type: 'voice_clone_used',
          title: 'Voix clonée utilisée',
          body: `Votre voix clonée a été utilisée pour générer l'audio de la leçon « ${lesson.title ?? lessonId} ».`,
          link: `/dashboard/courses/${courseId}`,
          email: false,
        }).catch((err) => logger.warn({ courseId, lessonId, err }, 'log traçabilité voix clonée échoué'));
      }
    }

    // Reprise granulaire (P69) : chaque slide synthétisée est checkpointée
    // (GenerationJob.checkpoint) AVANT de passer à la suivante. Si le worker
    // crashe au milieu de la boucle, la relance rejoue les slides déjà faites
    // depuis le checkpoint (aucun re-appel payant, aucun saut) et ne traite
    // réellement que les slides restantes.
    interface SlideAudioCheckpoint {
      audioKey: string;
      audioSeconds: number;
      provider: string;
    }

    const { results: slideResults } = await withCheckpoint<typeof script.slides[number], SlideAudioCheckpoint>({
      jobId: lessonId,
      steps: script.slides,
      store: mongoCheckpointStore(courseId, QUEUES.tts),
      runStep: async (slide, index) => {
        // Annulation (P73) : vérifiée AVANT chaque slide — une annulation en
        // cours de boucle arrête le traitement sans perdre les slides déjà faites
        // (checkpointées) ni bloquer sur un appel TTS inutile.
        await checkCancelled(courseId);
        const audioKey = lessonKeys.audio(index);

        // Audio manuel (Lot 4, plan 2026-07-20) : l'auteur a enregistré/uploadé
        // sa propre narration pour cette slide — on COPIE son fichier normalisé
        // au lieu d'appeler le TTS, quel que soit le mode (dialogue inclus).
        // C'est ce qui fait « survivre » l'enregistrement manuel à toute
        // régénération de la leçon (script édité, image changée, etc.).
        if (slide.audioSource === 'manual' && slide.manualAudioKey) {
          await copyObjectToLessonAudio(slide.manualAudioKey, audioKey);
          logger.info({ lessonId, index }, 'audio manuel appliqué (synthèse TTS ignorée)');
          return { audioKey, audioSeconds: slide.audioSeconds ?? 0, provider: 'manual' };
        }

        // Retire d'éventuelles balises de dialogue pour ne JAMAIS les narrer.
        const stripDialogueTags = (t: string) =>
          t.replace(/\[(?:Formateur|Apprenant)\]/g, '').replace(/\s{2,}/g, ' ').trim();

        let seconds: number;
        let provider: string;
        // Temps d'appel réel (dashboard super-admin, 2026-07-29) : renseigné
        // uniquement pour les branches synthesizeSlide (mono-voix) —
        // synthesizeDialogueSlide (bi-voix) n'est pas encore chronométrée.
        let durationMs: number | undefined;
        const turns = dialogueMode ? parseDialogueTurns(slide.narration) : null;
        if (turns) {
          try {
            const r = await synthesizeDialogueSlide(turns, audioKey, {
              locale,
              voice,
              secondVoice,
              speed: narrationSpeed,
              plan,
              voiceSampleB64,
              voiceSampleId,
              ttsEngine,
              edgeVoice,
              secondEdgeVoice,
              secondVoiceSampleB64,
              secondVoiceSampleId,
            });
            seconds = r.seconds;
            provider = r.provider;
          } catch (err) {
            logger.warn({ lessonId, index, err }, 'dialogue bi-voix indisponible — repli mono-voix');
            const res = await synthesizeSlide({
              text: stripDialogueTags(slide.narration),
              locale,
              voice,
              speed: narrationSpeed,
              plan,
              voiceSampleB64,
              voiceSampleId,
              ttsEngine,
              edgeVoice,
              context: `${courseId}:${lessonId}:slide${index}`,
            });
            await copyObjectToLessonAudio(res.cacheKey, audioKey);
            seconds = res.seconds;
            provider = res.provider;
            durationMs = res.durationMs;
          }
        } else {
          const res = await synthesizeSlide({
            text: dialogueMode ? stripDialogueTags(slide.narration) : slide.narration,
            locale,
            voice,
            speed: narrationSpeed,
            plan,
            voiceSampleB64,
            voiceSampleId,
            ttsEngine,
            edgeVoice,
            context: `${courseId}:${lessonId}:slide${index}`,
          });
          await copyObjectToLessonAudio(res.cacheKey, audioKey);
          seconds = res.seconds;
          provider = res.provider;
          durationMs = res.durationMs;
        }

        // Coût TTS : facturé au caractère, uniquement pour une vraie synthèse
        // (un hit de cache a déjà été facturé lors de sa première production).
        if (provider !== 'cache') {
          await recordTtsCost(
            { courseId, userId: String(course.userId) },
            slide.narration.length,
            provider,
            durationMs,
          ).catch(() => undefined);
        }

        logger.info({ lessonId, index, provider, seconds }, 'audio de slide prêt');
        return { audioKey, audioSeconds: seconds, provider };
      },
      onStep: async ({ index, total, result, resumed }) => {
        // Réapplique le résultat (rejoué ou frais) sur la slide en mémoire, et
        // persiste immédiatement le script partiel : une reprise ultérieure
        // (même sans checkpoint, ex. inspection manuelle) retrouve l'état réel.
        const target = script.slides[index];
        if (target) {
          target.audioKey = result.audioKey;
          target.audioSeconds = result.audioSeconds;
        }
        if (!resumed) {
          lesson.script = script;
          lesson.markModified('script');
          await lesson.save().catch(() => undefined);
        }
        const pct = 10 + Math.round(((index + 1) / total) * 80);
        await report(courseId, pct, `Synthèse vocale slide ${index + 1}/${total}${resumed ? ' (déjà faite — reprise)' : ''}`);
      },
    });

    // ── Garde de cohérence de voix (fix « voix multiples » 2026-07-26) ──────
    // Même avec l'épinglage d'identité, un basculement de moteur EN COURS de
    // leçon (panne transitoire du GPU) laisse des slides au timbre légèrement
    // différent. On détecte les leçons « mélangées » et on reconverge les
    // slides minoritaires vers le moteur MAJORITAIRE (bypassCache + exclusion
    // des autres moteurs). Best-effort : une slide qui refuse de converger
    // garde son audio (leçon complète > pureté). Jamais en aperçu rapide, ni
    // en mode dialogue (le mélange de deux voix y est voulu, et une resynthèse
    // mono écraserait la structure de dialogue).
    if (mode !== 'quick-preview' && !dialogueMode) {
      const REAL: TtsProvider[] = ['modal', 'qwen3', 'edge', 'piper', 'kokoro', 'elevenlabs', 'openai'];
      const isReal = (p: string): p is TtsProvider => (REAL as string[]).includes(p);
      const counts = new Map<string, number>();
      for (const r of slideResults) {
        if (isReal(r.provider)) counts.set(r.provider, (counts.get(r.provider) ?? 0) + 1);
      }
      if (counts.size > 1) {
        const premium = new Set(['modal', 'qwen3']);
        const target = [...counts.entries()].sort(
          (a, b) => b[1] - a[1] || Number(premium.has(b[0])) - Number(premium.has(a[0])),
        )[0]![0] as TtsProvider;
        const exclude = REAL.filter((p) => p !== target);
        logger.warn(
          { lessonId, providers: Object.fromEntries(counts), target },
          'voix mélangées détectées dans la leçon — reconvergence vers le moteur majoritaire',
        );
        await report(courseId, 92, 'Uniformisation de la voix de la leçon');
        let converged = 0;
        for (let i = 0; i < slideResults.length; i += 1) {
          const r = slideResults[i]!;
          if (!isReal(r.provider) || r.provider === target) continue;
          const slide = script.slides[i];
          if (!slide || (slide.audioSource === 'manual' && slide.manualAudioKey)) continue;
          try {
            const res = await synthesizeSlide({
              text: slide.narration,
              locale,
              voice,
              speed: narrationSpeed,
              plan,
              voiceSampleB64,
              voiceSampleId,
              ttsEngine,
              edgeVoice,
              bypassCache: true,
              excludeProviders: exclude,
              context: `${courseId}:${lessonId}:slide${i}:voice-consistency`,
            });
            // On n'applique la resynthèse QUE si elle vient bien du moteur
            // cible — sinon on garderait un troisième timbre au lieu de deux.
            if (res.provider === target) {
              await copyObjectToLessonAudio(res.cacheKey, r.audioKey);
              slide.audioSeconds = res.seconds;
              r.audioSeconds = res.seconds;
              r.provider = target;
              converged += 1;
            } else {
              logger.warn(
                { lessonId, index: i, expected: target, got: res.provider },
                'reconvergence : le moteur cible reste indisponible — audio existant conservé',
              );
            }
          } catch (err) {
            logger.warn({ lessonId, index: i, err }, 'reconvergence de voix impossible pour cette slide — audio existant conservé');
          }
        }
        if (converged > 0) {
          logger.info({ lessonId, converged, target }, 'voix de la leçon uniformisée');
        }
      }
    }

    const totalSeconds = slideResults.reduce((acc, r) => acc + r.audioSeconds, 0);

    // Persiste le script final (audioKey/audioSeconds par slide) + la durée audio agrégée.
    lesson.script = script;
    lesson.durationMin = Math.max(1, Math.round((totalSeconds / 60) * 10) / 10);
    lesson.markModified('script');
    // Moteur ayant produit CETTE narration (audit 2026-07-22, additif) — jamais
    // en aperçu rapide (draft jetable, voix standard forcée, ne doit pas écraser
    // le moteur réel de la leçon). Sert de base au bouton « switch » (audio-repair).
    if (mode !== 'quick-preview') {
      lesson.assets.ttsEngine = ttsEngine ?? 'chatterbox';
      lesson.markModified('assets');
    }
    await lesson.save();

    await report(courseId, 95, `Audio complet (${script.slides.length} slides, ${Math.round(totalSeconds)} s) — passage au rendu vidéo`);

    // Enchaîne sur le rendu vidéo de la leçon (jobId déterministe = déduplication).
    // Priorité (P73) selon le plan du propriétaire du cours (déjà résolu ci-dessus).
    const videoPriority = priorityForPlan(plan);
    const renderQueue = createQueue(QUEUES.videoRender);
    const renderJobId = makeJobId(courseId, QUEUES.videoRender, lessonId);
    // Purge une exécution PRÉCÉDENTE du même jobId (terminée ou échouée,
    // retenue par removeOnComplete/Fail) : sans cela, BullMQ IGNORE
    // silencieusement le nouvel add() et une régénération ne re-rend jamais
    // la vidéo (constaté : leçon régénérée restée sans videoUrl).
    await renderQueue.remove(renderJobId).catch(() => undefined);
    await renderQueue.add(
      QUEUES.videoRender,
      { courseId, lessonId, ...(mode ? { mode } : {}) },
      { jobId: renderJobId, priority: videoPriority },
    );

    await report(courseId, 100, `Synthèse vocale terminée : ${script.slides.length} slides`);
    const result: TtsResult = {
      courseId,
      lessonId,
      slides: script.slides.length,
      totalSeconds: Math.round(totalSeconds * 100) / 100,
    };
    logger.info({ ...result }, 'tts-generation terminée, video-render enfilé');
    return result;
  } catch (err) {
    // Annulation utilisateur (P73) : arrêt propre, PAS de retry BullMQ (le job
    // ne se remet pas en file — le cours est déjà 'cancelled').
    if (err instanceof CourseCancelledError) {
      logger.info({ courseId, lessonId }, 'synthèse vocale interrompue (cours annulé)');
      await report(courseId, 0, 'Génération annulée par l\'utilisateur.', 'warn').catch(() => undefined);
      return { courseId, lessonId, slides: 0, totalSeconds: 0 };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec de la synthèse vocale');
    await report(courseId, 0, `Échec de la synthèse vocale : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
