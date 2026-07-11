// Traduction des cours publiés (Prompt 92) : pour un cours DÉJÀ déployé, pipeline
// de localisation — traduit les sous-titres .srt existants (segment par segment,
// timestamps conservés) dans jusqu'à 10 langues cibles, uploade les captions sur
// la/les plateforme(s) via une méthode optionnelle `addCaptions` de l'adapter, et
// peut optionnellement produire une version DOUBLÉE (nouveau TTS + nouveau MP4).
//
// Ce module regroupe la logique PURE et testable (parsing SRT, découpe en lots
// pour l'appel LLM, sélection des langues cibles, reconstruction du SRT traduit).
// L'orchestration I/O (lecture/écriture S3, appel Claude, appel de l'adapter,
// appel TTS/vidéo) vit dans les fonctions exportées plus bas, appelées par un
// processor ou une route API — jamais de dépendance dure sur BullMQ ici.

import { z } from 'zod';
import {
  Course,
  Deployment,
  Lesson,
  LOCALES,
  Section,
  getConfig,
  getObjectStream,
  objectExists,
  storageKeys,
  uploadObject,
  type DeploymentDocument,
  type ICourse,
  type ILesson,
  type ISection,
  type Locale,
} from '../shared.js';
import { callClaudeJson } from './claude.js';
import { logger } from '../queues/index.js';
import type { Cue } from '../media/subtitles.js';
import { toSrt } from '../media/subtitles.js';
import { getAdapter, hasAdapter } from '../deploy/registry.js';
import type { BoundPublishProgress, DeployContext } from '../deploy/types.js';

/** Nombre maximal de langues cibles traitées par appel (borne du prompt). */
export const MAX_TARGET_LANGUAGES = 10;

/* ------------------------------------------------------------------ */
/* Parsing SRT → cues (pur)                                            */
/* ------------------------------------------------------------------ */

/** Convertit un timestamp SRT (`00:00:01,500`) en secondes. */
export function parseSrtTimestamp(ts: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(ts.trim());
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/**
 * Parse un fichier .srt en cues (start/end/text). Tolérant : ignore les blocs
 * malformés plutôt que de jeter — un sous-titre existant légèrement irrégulier
 * ne doit pas bloquer toute la traduction. Le texte multi-lignes d'un bloc est
 * rejoint par des espaces (un cue = une ligne de sous-titre logique).
 */
export function parseSrt(content: string): Cue[] {
  const blocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    // Ligne 0 = index (ignoré), ligne 1 = timing, reste = texte.
    const timingLine = lines.find((l) => l.includes('-->'));
    if (!timingLine) continue;
    const [rawStart, rawEnd] = timingLine.split('-->').map((s) => s.trim());
    if (!rawStart || !rawEnd) continue;
    const start = parseSrtTimestamp(rawStart);
    const end = parseSrtTimestamp(rawEnd.split(' ')[0] ?? rawEnd);
    const timingIndex = lines.indexOf(timingLine);
    const text = lines
      .slice(timingIndex + 1)
      .join(' ')
      .trim();
    if (text.length === 0) continue;
    cues.push({ start, end, text });
  }
  return cues;
}

/* ------------------------------------------------------------------ */
/* Sélection des langues cibles (pur)                                  */
/* ------------------------------------------------------------------ */

/**
 * Filtre/valide une liste de langues cibles demandées : langues connues
 * (LOCALES) uniquement, dédoublonnées, langue source exclue, bornées à
 * MAX_TARGET_LANGUAGES. Ordre de la demande préservé.
 */
export function selectTargetLocales(
  requested: readonly string[],
  sourceLocale: Locale,
): Locale[] {
  const seen = new Set<Locale>();
  const result: Locale[] = [];
  for (const raw of requested) {
    const locale = (LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : undefined;
    if (!locale || locale === sourceLocale || seen.has(locale)) continue;
    seen.add(locale);
    result.push(locale);
    if (result.length >= MAX_TARGET_LANGUAGES) break;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Traduction segment par segment (schéma + prompts)                   */
/* ------------------------------------------------------------------ */

/** Un segment à traduire : index stable (pour réassembler dans l'ordre) + texte. */
export interface TranslatableSegment {
  index: number;
  text: string;
}

/** Schéma de la réponse LLM : liste de segments traduits, même index, même longueur. */
export const translatedSegmentsSchema = z.object({
  segments: z
    .array(
      z.object({
        index: z.number().int().min(0),
        text: z.string().min(1),
      }),
    )
    .min(1),
});

export type TranslatedSegments = z.infer<typeof translatedSegmentsSchema>;

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'français',
  en: 'anglais',
  ar: 'arabe',
};

/** Prompt système : traduire des cues de sous-titres SANS toucher aux timestamps ni à l'ordre. */
export function translateSubtitlesSystemPrompt(targetLocale: Locale): string {
  return [
    `Tu es un traducteur professionnel de sous-titres de cours en ligne.`,
    `On te fournit une liste de segments {index, text} extraits d'un fichier .srt.`,
    `Traduis CHAQUE texte en ${LOCALE_LABELS[targetLocale]}, en conservant :`,
    `- le même nombre de segments,`,
    `- le même "index" pour chaque segment (ne les réordonne jamais),`,
    `- une traduction naturelle, concise (un sous-titre doit rester lisible rapidement).`,
    `Ne modifie ni ne fusionne jamais les segments : un segment source = un segment traduit.`,
    ``,
    `FORMAT DE SORTIE — réponds UNIQUEMENT avec {"segments": [{"index": n, "text": "..."}, ...]}, sans texte autour ni fence Markdown.`,
  ].join('\n');
}

/** Prompt utilisateur : segments source sérialisés. */
export function translateSubtitlesUserPrompt(segments: readonly TranslatableSegment[]): string {
  return [
    `Segments à traduire (JSON) :`,
    JSON.stringify(segments, null, 2),
  ].join('\n');
}

/**
 * Vérifie que la traduction préserve la structure (mêmes index, même nombre de
 * segments) — retourne la liste des écarts (vide = conforme). Réutilisé pour
 * réinjecter un feedback au LLM en cas d'échec (cf. validateTranslationStructure
 * dans derive.ts, même esprit appliqué aux segments de sous-titres).
 */
export function validateSubtitleTranslation(
  source: readonly TranslatableSegment[],
  translated: TranslatedSegments,
): string[] {
  const problems: string[] = [];
  if (translated.segments.length !== source.length) {
    problems.push(
      `Nombre de segments divergent : ${translated.segments.length} au lieu de ${source.length}.`,
    );
    return problems;
  }
  const sourceIndices = new Set(source.map((s) => s.index));
  for (const seg of translated.segments) {
    if (!sourceIndices.has(seg.index)) {
      problems.push(`Index inattendu dans la traduction : ${seg.index}.`);
    }
  }
  return problems;
}

/**
 * Reconstruit les cues traduits : timestamps du SRT source, texte traduit
 * réaligné par index. Un segment traduit manquant retombe sur le texte source
 * (jamais de cue vide/perdu).
 */
export function applyTranslatedSegments(
  sourceCues: readonly Cue[],
  translated: TranslatedSegments,
): Cue[] {
  const byIndex = new Map(translated.segments.map((s) => [s.index, s.text]));
  return sourceCues.map((cue, i) => ({
    start: cue.start,
    end: cue.end,
    text: byIndex.get(i) ?? cue.text,
  }));
}

/* ------------------------------------------------------------------ */
/* Orchestration : traduction d'un .srt complet dans une langue cible   */
/* ------------------------------------------------------------------ */

export interface TranslateSrtResult {
  locale: Locale;
  srt: string;
  cues: Cue[];
}

/**
 * Traduit un contenu .srt complet vers `targetLocale` via callClaudeJson (mode
 * MOCK_PROVIDERS-aware — callClaudeJson bascule seul sur fixture déterministe).
 * Segment par segment, timestamps INCHANGÉS. `skipCache` par défaut à false :
 * deux cours demandant la même traduction d'un texte identique réutilisent le
 * cache Redis (cf. callClaudeJson).
 */
export async function translateSrtContent(
  srtContent: string,
  targetLocale: Locale,
  courseId?: string,
): Promise<TranslateSrtResult> {
  const sourceCues = parseSrt(srtContent);
  if (sourceCues.length === 0) {
    return { locale: targetLocale, srt: srtContent, cues: [] };
  }

  const segments: TranslatableSegment[] = sourceCues.map((cue, index) => ({
    index,
    text: cue.text,
  }));

  const translated = await callClaudeJson({
    schema: translatedSegmentsSchema,
    system: translateSubtitlesSystemPrompt(targetLocale),
    user: translateSubtitlesUserPrompt(segments),
    cost: courseId ? { courseId } : undefined,
  });

  const problems = validateSubtitleTranslation(segments, translated);
  if (problems.length > 0) {
    // Repli honnête : structure non conforme → on garde le texte source pour les
    // segments incohérents plutôt que de perdre le sous-titrage (best-effort).
    const salvaged: TranslatedSegments = {
      segments: segments.map((s) => {
        const match = translated.segments.find((t) => t.index === s.index);
        return match ?? { index: s.index, text: s.text };
      }),
    };
    const cues = applyTranslatedSegments(sourceCues, salvaged);
    return { locale: targetLocale, srt: toSrt(cues), cues };
  }

  const cues = applyTranslatedSegments(sourceCues, translated);
  return { locale: targetLocale, srt: toSrt(cues), cues };
}

/**
 * Traduit un .srt dans plusieurs langues cibles (séquentiel — volontairement
 * simple, la parallélisation est laissée à l'appelant s'il en a besoin). Une
 * langue en échec n'interrompt pas les autres : elle est omise du résultat et
 * l'erreur est renvoyée dans `errors`.
 */
export async function translateSrtToLocales(
  srtContent: string,
  targetLocales: readonly Locale[],
  courseId?: string,
): Promise<{ results: TranslateSrtResult[]; errors: Array<{ locale: Locale; message: string }> }> {
  const results: TranslateSrtResult[] = [];
  const errors: Array<{ locale: Locale; message: string }> = [];
  for (const locale of targetLocales) {
    try {
      results.push(await translateSrtContent(srtContent, locale, courseId));
    } catch (err) {
      errors.push({ locale, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, errors };
}

/* ------------------------------------------------------------------ */
/* Orchestration I/O : traduction d'un cours DÉJÀ déployé (P92)         */
/* ------------------------------------------------------------------ */

export interface TranslatePublishedCourseResult {
  courseId: string;
  /** Langues effectivement traitées (au moins un .srt trouvé et traduit). */
  locales: Locale[];
  /** Nombre de leçons dont le .srt a été traduit (toutes langues confondues). */
  lessonsTranslated: number;
  /** Nombre de leçons dont les captions ont été poussées sur au moins un déploiement. */
  captionsUploaded: number;
  /** Doublage effectivement lancé (dub=true ET au moins une leçon vidéo traitée). */
  dubbed: boolean;
  errors: Array<{ locale: string; lessonId?: string; message: string }>;
}

/**
 * Traduit les sous-titres de TOUTES les leçons vidéo d'un cours déjà déployé,
 * dans chacune des langues cibles fournies, puis pousse les captions traduites
 * sur chaque plateforme où le cours a un Deployment (via l'adapter.addCaptions
 * — no-op si l'adapter ne le supporte pas). Si `dub` est vrai, régénère aussi
 * l'audio (TTS) et le MP4 dans la langue cible (Course.dubbedVersions).
 * Best-effort par leçon/langue : une erreur isolée n'interrompt pas le reste,
 * elle est collectée dans `errors`.
 */
export async function translatePublishedCourse(
  courseId: string,
  requestedLocales: readonly string[],
  options: { dub?: boolean; platforms?: readonly string[] } = {},
): Promise<TranslatePublishedCourseResult> {
  const course = (await Course.findById(courseId)) as (ICourse & { _id: unknown; save: () => Promise<unknown> }) | null;
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const sourceLocale = course.locale;
  const targetLocales = selectTargetLocales(requestedLocales, sourceLocale);
  const errors: Array<{ locale: string; lessonId?: string; message: string }> = [];
  if (targetLocales.length === 0) {
    return {
      courseId,
      locales: [],
      lessonsTranslated: 0,
      captionsUploaded: 0,
      dubbed: false,
      errors: [{ locale: '(aucune)', message: 'Aucune langue cible valide (déjà la langue source ou inconnue).' }],
    };
  }

  const [sections, lessons, deployments] = await Promise.all([
    Section.find({ courseId }).sort({ order: 1 }).lean<ISection[]>(),
    Lesson.find({ courseId, type: 'video' }).sort({ order: 1 }).lean<ILesson[]>(),
    Deployment.find({ courseId }),
  ]);

  let lessonsTranslated = 0;
  let captionsUploaded = 0;
  const dub = options.dub ?? false;
  // dubbedVersions par locale : accumulateur avant sauvegarde finale sur le cours.
  const dubAccumulator = new Map<Locale, { srtKeys: string[]; videoKeys: string[] }>();

  for (const locale of targetLocales) {
    const dubEntry = { srtKeys: [] as string[], videoKeys: [] as string[] };
    dubAccumulator.set(locale, dubEntry);

    for (const lesson of lessons) {
      const lessonId = String((lesson as { _id?: unknown })._id ?? '');
      const section = sections.find((s) => String((s as { _id?: unknown })._id ?? '') === String(lesson.sectionId));
      const keys = storageKeys.course(courseId).lesson(section?.order ?? 0, lesson.order);

      try {
        if (!(await objectExists(keys.captionsSrt()))) continue; // pas de sous-titres source : rien à traduire.
        const srtContent = await readTextObject(keys.captionsSrt());
        const translated = await translateSrtContent(srtContent, locale, courseId);
        const localizedKey = keys.captionsSrtLocalized(locale);
        await uploadObject(localizedKey, translated.srt, 'application/x-subrip');
        dubEntry.srtKeys.push(localizedKey);
        lessonsTranslated += 1;

        // Upload des captions sur chaque plateforme déployée (best-effort par plateforme).
        for (const deployment of deployments) {
          if (options.platforms && !options.platforms.includes(deployment.platform)) continue;
          if (!hasAdapter(deployment.platform)) continue;
          try {
            await uploadCaptionsToAdapter(course, deployment, sections, lessons, lesson, locale, translated.srt);
            captionsUploaded += 1;
          } catch (err) {
            errors.push({
              locale,
              lessonId,
              message: `upload captions ${deployment.platform} : ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }

        // Doublage optionnel : nouvel audio + nouvelle vidéo, cues traduits.
        if (dub) {
          try {
            const videoKey = await dubLessonVideo(courseId, lessonId, keys.video(), translated.cues, locale, course.ttsVoice);
            if (videoKey) dubEntry.videoKeys.push(videoKey);
          } catch (err) {
            errors.push({
              locale,
              lessonId,
              message: `doublage : ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      } catch (err) {
        errors.push({ locale, lessonId, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // Persistance Course.dubbedVersions : une entrée par locale traitée (remplace l'existante).
  const existing = Array.isArray(course.dubbedVersions) ? course.dubbedVersions : [];
  const kept = existing.filter((v) => !targetLocales.includes(v.locale));
  const now = new Date();
  const added = targetLocales.map((locale) => {
    const entry = dubAccumulator.get(locale)!;
    return {
      locale,
      status: (dub ? (entry.videoKeys.length > 0 ? 'ready' : 'failed') : 'ready') as
        | 'ready'
        | 'failed',
      srtKeys: entry.srtKeys,
      videoKeys: entry.videoKeys,
      createdAt: now,
      updatedAt: now,
    };
  });
  course.dubbedVersions = [...kept, ...added];
  await course.save();

  return {
    courseId,
    locales: targetLocales,
    lessonsTranslated,
    captionsUploaded,
    dubbed: dub && added.some((a) => a.videoKeys.length > 0),
    errors,
  };
}

/** Lit un objet stockage en texte (utilitaire local, évite une dépendance croisée sur les helpers privés des adapters). */
async function readTextObject(key: string): Promise<string> {
  const stream = await getObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Construit un DeployContext minimal (best-effort) pour appeler adapter.addCaptions hors flow complet de déploiement. */
async function uploadCaptionsToAdapter(
  course: ICourse & { _id: unknown },
  deployment: DeploymentDocument,
  sections: ISection[],
  lessons: ILesson[],
  lesson: ILesson,
  locale: Locale,
  srtContent: string,
): Promise<void> {
  const adapter = getAdapter(deployment.platform);
  const noopProgress: BoundPublishProgress = async () => undefined;
  const ctx: DeployContext = {
    platform: deployment.platform,
    mode: deployment.mode,
    course,
    sections,
    lessons,
    credentials: {},
    credentialId: deployment.credentialId ? String(deployment.credentialId) : undefined,
    checkpoint: { lessonIndex: deployment.checkpoint?.lessonIndex ?? 0, step: deployment.checkpoint?.step ?? '' },
    externalId: deployment.externalId,
    publishProgress: noopProgress,
    logger,
    // Aligné sur le mode global (MOCK_PROVIDERS) : en mock, addCaptions ne doit
    // lancer aucun navigateur/appel réseau réel, comme le reste du pipeline.
    mock: getConfig().MOCK_PROVIDERS,
    deployment,
  };
  const index = lessons.findIndex((l) => String((l as { _id?: unknown })._id ?? '') === String((lesson as { _id?: unknown })._id ?? ''));
  await adapter.addCaptions?.(ctx, lesson, index >= 0 ? index : 0, locale, srtContent);
}

/**
 * Doublage d'une leçon (P92) : régénère l'audio de chaque cue traduit (tts.ts,
 * cache Redis/S3 déjà intégré) puis réassemble un nouveau MP4 en réutilisant
 * les slides PNG déjà rendues (visuel inchangé, seule la narration change).
 * Retourne la clé S3 du MP4 doublé, ou undefined si la vidéo source est absente
 * (rendu vidéo pas encore terminé — on ne bloque jamais la traduction pour ça).
 */
async function dubLessonVideo(
  courseId: string,
  lessonId: string,
  sourceVideoKey: string,
  cues: readonly Cue[],
  locale: Locale,
  ttsVoice: string | undefined,
): Promise<string | undefined> {
  if (cues.length === 0) return undefined;
  if (!(await objectExists(sourceVideoKey))) return undefined;

  // Import différé : évite de charger execa/ffmpeg helpers quand le doublage
  // n'est pas demandé (traduction des sous-titres seule, cas le plus courant).
  const { renderDubbedVideoFromCues } = await import('./translate-published-render.js');
  return renderDubbedVideoFromCues({ courseId, lessonId, sourceVideoKey, cues, locale, ttsVoice });
}
