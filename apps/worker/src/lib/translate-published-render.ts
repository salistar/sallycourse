// Rendu vidéo du doublage (Prompt 92) — isolé de translate-published.ts pour ne
// charger execa/ffmpeg que lorsque le doublage est réellement demandé (dub=true).
//
// REDESIGN 2026-07-17 : on NE reconstruit PLUS la vidéo depuis les slides. La
// vidéo source (video.mp4) est conservée TELLE QUELLE (visuel + timing d'origine
// identiques) ; on remplace UNIQUEMENT sa piste audio par la narration traduite
// (buildAudioReplaceArgs, copie vidéo, zéro réencodage image). L'ancienne version
// mappait cue_i → slide_i, or les .srt viennent de Whisper (~130 micro-cues pour
// ~8 slides) → « slide manquante, arrêt du montage » dès i=8 : le doublage
// n'aboutissait jamais. Ici les cues traduits sont regroupés en phrases, chaque
// phrase est resynthétisée (TTS langue cible, voix clonée optionnelle) et POSÉE
// à son timestamp sur un lit de room tone de la durée exacte de la vidéo.
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { execa } from 'execa';
import {
  Lesson,
  Section,
  getObjectStream,
  storageKeys,
  uploadObject,
  type Locale,
} from '../shared.js';
import { AUDIO_BITRATE, buildAudioReplaceArgs, probeVideo } from '../media/video-render.js';
import { synthesizeSlide } from '../media/tts.js';
import type { Cue } from '../media/subtitles.js';
import { logger } from '../queues/index.js';

/** Télécharge un objet S3 vers un fichier local ; false si absent. */
async function downloadToFile(key: string, dest: string): Promise<boolean> {
  try {
    const stream = (await getObjectStream(key)) as Readable;
    await pipeline(stream, createWriteStream(dest));
    return true;
  } catch {
    return false;
  }
}

export interface RenderDubbedVideoParams {
  courseId: string;
  lessonId: string;
  /** Clé S3 de la vidéo source (sert uniquement à retrouver sectionOrder/lessonOrder via la leçon). */
  sourceVideoKey: string;
  /** Cues traduits (texte cible), timestamps du .srt d'origine — resynthétisés en audio. */
  cues: readonly Cue[];
  locale: Locale;
  ttsVoice?: string;
  /** Voix CLONÉE de l'instructeur (WAV base64 + id) — la narration doublée sonne
   *  alors comme lui dans la langue cible (« ta voix dans 10 langues »). Chargée
   *  UNE fois par l'appelant (loadCourseVoiceSample). Absent → voix standard. */
  voiceSampleB64?: string;
  voiceSampleId?: string;
}

/** Une phrase doublée : texte regroupé + fenêtre temporelle du .srt source. */
export interface DubPhrase {
  text: string;
  start: number;
  end: number;
}

/**
 * Regroupe des cues (micro-segments Whisper) en PHRASES : on accumule les cues
 * consécutifs jusqu'à une ponctuation de fin (. ! ? … :) ou ~14 mots. Divise le
 * nombre d'appels TTS par ~5-8 vs le doublage par cue et donne une prosodie plus
 * naturelle (phrases entières plutôt que fragments). La fenêtre = [1er.start,
 * dernier.end]. Fonction PURE (testable).
 */
export function groupCuesIntoPhrases(cues: readonly Cue[]): DubPhrase[] {
  const phrases: DubPhrase[] = [];
  let cur: DubPhrase | null = null;
  for (const cue of cues) {
    const text = cue.text.trim();
    if (!text) continue;
    if (!cur) cur = { text, start: cue.start, end: cue.end };
    else {
      cur.text = `${cur.text} ${text}`;
      cur.end = cue.end;
    }
    const words = cur.text.split(/\s+/).length;
    if (/[.!?:…]["»)]?$/.test(cur.text) || words >= 14) {
      phrases.push(cur);
      cur = null;
    }
  }
  if (cur) phrases.push(cur);
  return phrases;
}

/** Un clip audio à poser sur la timeline : fichier + position + accélération. */
export interface DubAudioClip {
  path: string;
  startSec: number;
  /** Facteur atempo (≥ 1 : accélère pour tenir dans la fenêtre ; jamais < 1). */
  tempo: number;
}

/**
 * Args ffmpeg PURS construisant la piste audio doublée : chaque clip de phrase
 * est resamplé 48 kHz, éventuellement accéléré (atempo) pour ne pas déborder sur
 * la phrase suivante, puis DÉCALÉ à son timestamp (adelay) et mixé sur un lit de
 * room tone continu (~-66 dB) de la durée EXACTE de la vidéo. `duration=first`
 * (le bed) fixe la longueur ; alimiter borne les rares chevauchements. Aucune
 * dérive cumulative : chaque clip est ancré à sa position absolue.
 */
export function buildDubbedAudioArgs(
  clips: readonly DubAudioClip[],
  videoDurationSec: number,
  output: string,
): string[] {
  const args = ['-y'];
  for (const clip of clips) args.push('-i', clip.path);

  const fmt = 'aformat=sample_fmts=fltp:channel_layouts=stereo';
  const filters: string[] = [
    // Lit de room tone (mêmes réglages que buildLessonAudioArgs) borné à la durée vidéo.
    `anoisesrc=colour=pink:sample_rate=48000:amplitude=0.0025:seed=42,${fmt},highpass=f=50,lowpass=f=8000,atrim=0:${videoDurationSec.toFixed(3)}[bed]`,
  ];
  clips.forEach((clip, i) => {
    const tempo = clip.tempo > 1.001 ? `atempo=${clip.tempo.toFixed(3)},` : '';
    const delayMs = Math.max(0, Math.round(clip.startSec * 1000));
    filters.push(`[${i}:a]aresample=48000,${fmt},${tempo}adelay=${delayMs}:all=1[c${i}]`);
  });
  const mixInputs = ['[bed]', ...clips.map((_, i) => `[c${i}]`)].join('');
  filters.push(
    `${mixInputs}amix=inputs=${clips.length + 1}:duration=first:normalize=0,alimiter=limit=0.977[out]`,
  );

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-c:a',
    'aac',
    '-b:a',
    AUDIO_BITRATE,
    '-ar',
    '48000',
    '-ac',
    '2',
    output,
  );
  return args;
}

/**
 * Doublage d'une leçon : conserve la vidéo source et remplace sa piste audio par
 * la narration traduite. Uploadé sous storageKeys…videoLocalized(locale).
 * Retourne la clé S3, ou undefined si la vidéo source est introuvable (rendu
 * vidéo pas encore terminé — on ne bloque jamais la traduction pour ça).
 */
export async function renderDubbedVideoFromCues(params: RenderDubbedVideoParams): Promise<string | undefined> {
  const { courseId, lessonId, sourceVideoKey, cues, locale, ttsVoice, voiceSampleB64, voiceSampleId } = params;
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return undefined;
  const section = await Section.findById(lesson.sectionId);
  const sectionOrder = section?.order ?? 0;
  const keys = storageKeys.course(courseId).lesson(sectionOrder, lesson.order);

  const phrases = groupCuesIntoPhrases(cues);
  if (phrases.length === 0) return undefined;

  const dir = await mkdtemp(path.join(tmpdir(), `dub-${lessonId}-${locale}-`));
  try {
    // 1) Vidéo source intacte + sa durée réelle (référence de la timeline audio).
    const videoPath = path.join(dir, 'source.mp4');
    if (!(await downloadToFile(sourceVideoKey, videoPath))) return undefined;
    const probe = await probeVideo(videoPath).catch(() => undefined);
    const videoDuration = probe && probe.durationSec > 0 ? probe.durationSec : phrases[phrases.length - 1]!.end;

    // 2) TTS de chaque phrase + calcul du facteur d'accélération pour rester
    //    dans sa fenêtre (jamais ralentir : le room tone comble les silences).
    const clips: DubAudioClip[] = [];
    for (let i = 0; i < phrases.length; i += 1) {
      const phrase = phrases[i]!;
      const synth = await synthesizeSlide({
        text: phrase.text,
        locale,
        voice: ttsVoice,
        ...(voiceSampleB64 && voiceSampleId ? { voiceSampleB64, voiceSampleId } : {}),
      });
      const clipPath = path.join(dir, `phrase-${i}.mp3`);
      if (!(await downloadToFile(synth.cacheKey, clipPath))) continue;
      const window = Math.max(0.4, phrase.end - phrase.start);
      const ttsDur = synth.seconds > 0 ? synth.seconds : window;
      // Accélère seulement si la narration dépasse sa fenêtre (>5 %), plafonné à
      // 1,5× pour éviter l'effet « chipmunk » — un léger débordement reste toléré.
      const tempo = Math.min(1.5, Math.max(1, ttsDur / window > 1.05 ? ttsDur / window : 1));
      clips.push({ path: clipPath, startSec: phrase.start, tempo });
    }
    if (clips.length === 0) return undefined;

    // 3) Construit la piste audio doublée puis la remuxe sur la vidéo INTACTE.
    const dubbedAudio = path.join(dir, 'audio.m4a');
    await execa('ffmpeg', buildDubbedAudioArgs(clips, videoDuration, dubbedAudio));
    const finalPath = path.join(dir, 'dubbed.mp4');
    await execa('ffmpeg', buildAudioReplaceArgs(videoPath, dubbedAudio, finalPath));

    await probeVideo(finalPath).catch(() => undefined);

    const videoKey = keys.videoLocalized(locale);
    await uploadObject(videoKey, await readFile(finalPath), 'video/mp4');
    logger.info(
      { courseId, lessonId, locale, videoKey, phrases: phrases.length, clips: clips.length },
      'vidéo doublée (remux audio sur source) rendue et uploadée',
    );
    return videoKey;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
