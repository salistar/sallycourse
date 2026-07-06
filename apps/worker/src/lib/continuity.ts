// Cohérence inter-leçons (P19) : construit le contexte des leçons PRÉCÉDENTES
// d'un cours (résumés générés) pour l'injecter aux générateurs et éviter les
// répétitions / permettre des rappels « comme vu dans… ». Résume aussi une
// leçon après sa génération (stocké dans Lesson.generatedSummary).
import { z } from 'zod';
import {
  Lesson,
  Section,
  getConfig,
  type ILesson,
  type SlideScript,
  type TpContent,
} from '../shared.js';
import { callClaudeJson } from './claude.js';
import { logger } from '../queues/index.js';

/**
 * Budget approximatif du contexte de continuité, en tokens. On approxime
 * 1 token ≈ 4 caractères (heuristique répandue) : le contexte concaténé est
 * tronqué au PLUS ANCIEN pour tenir sous cette borne.
 */
export const CONTINUITY_MAX_TOKENS = 2000;
const CHARS_PER_TOKEN = 4;
export const CONTINUITY_MAX_CHARS = CONTINUITY_MAX_TOKENS * CHARS_PER_TOKEN;

/** Consignes anti-répétition ajoutées en tête du contexte transmis aux générateurs. */
const CONTINUITY_GUIDELINES =
  'Voici les résumés des leçons déjà produites dans ce cours. ' +
  'Évite de répéter ce qui a déjà été expliqué ; quand c\'est pertinent, fais un bref ' +
  'rappel du type « comme vu dans la leçon … » plutôt que de tout réexpliquer. ' +
  'Appuie-toi sur ces acquis pour aller plus loin.';

/** Réduit un texte à ses 2-3 premières phrases, borné en longueur. */
export function firstSentences(text: string, maxSentences = 3, maxChars = 320): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const sentences = normalized.match(/[^.!?]+[.!?]+/g) ?? [normalized];
  const kept = sentences.slice(0, maxSentences).join(' ').trim();
  const out = kept || normalized;
  return out.length > maxChars ? `${out.slice(0, maxChars - 1).trimEnd()}…` : out;
}

/**
 * Extrait un texte représentatif du contenu RÉELLEMENT généré d'une leçon,
 * selon son type — sans accès réseau (script en base, sinon résumé d'outline).
 * Utilisé pour le résumé mock déterministe.
 */
function extractLessonText(lesson: Pick<ILesson, 'type' | 'title' | 'summary' | 'script'>): string {
  if (lesson.type === 'video' && lesson.script) {
    const script = lesson.script as Partial<SlideScript>;
    const narrations = (script.slides ?? [])
      .map((s) => s?.narration ?? '')
      .filter(Boolean)
      .join(' ');
    if (narrations) return narrations;
  }
  if (lesson.type === 'tp' && lesson.script) {
    const tp = lesson.script as Partial<TpContent>;
    const parts = [tp.objective ?? '', ...(tp.steps ?? []).map((s) => s?.instruction ?? '')];
    const joined = parts.filter(Boolean).join(' ');
    if (joined) return joined;
  }
  // Article/quiz (contenu en S3) ou repli : le résumé d'outline reste pertinent.
  return lesson.summary ?? lesson.title;
}

/** Une leçon précédente résumée : titre + résumé généré. */
export interface ContinuityEntry {
  title: string;
  generatedSummary: string;
}

/**
 * Formate et TRONQUE le contexte de continuité (logique pure, testable sans
 * Mongo). `entries` est ordonné du plus ANCIEN au plus récent. On garde le
 * maximum d'entrées RÉCENTES tenant sous `maxChars` (troncature au plus ancien),
 * puis on rétablit l'ordre chronologique. Retourne `undefined` si vide.
 */
export function formatContinuityContext(
  entries: readonly ContinuityEntry[],
  maxChars: number = CONTINUITY_MAX_CHARS,
): string | undefined {
  const lines = entries
    .filter((e) => e.generatedSummary.trim().length > 0)
    .map((e) => `- ${e.title} : ${e.generatedSummary.trim()}`);
  if (lines.length === 0) return undefined;

  const kept: string[] = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    const cost = line.length + 1; // +1 : séparateur
    // Garde au moins la plus récente, même si elle dépasse à elle seule le budget.
    if (chars + cost > maxChars && kept.length > 0) break;
    kept.unshift(line);
    chars += cost;
  }

  return `${CONTINUITY_GUIDELINES}\n${kept.join('\n')}`;
}

const summarySchema = z.object({ summary: z.string().min(1) });

/** Prompt système du résumé de leçon (contrat de sortie strict). */
function summarizeSystemPrompt(): string {
  return [
    'Tu résumes une leçon de cours en ligne pour préparer la génération des leçons suivantes.',
    'Produis un résumé de 2 à 3 phrases, factuel, qui liste les notions clés réellement abordées.',
    'Pas de superlatifs, pas d\'introduction creuse : va droit aux concepts couverts.',
    'FORMAT DE SORTIE — réponds UNIQUEMENT avec un objet JSON : { "summary": string }',
  ].join('\n');
}

/** Prompt utilisateur : titre balisé « … » (extraction mock) + contenu à résumer. */
function summarizeUserPrompt(lessonTitle: string, content: string): string {
  return [
    `Résume la leçon « ${lessonTitle} » en 2-3 phrases.`,
    'Contenu de la leçon :',
    content,
  ].join('\n');
}

/**
 * Construit le contexte de continuité pour `currentLesson` : concatène les
 * résumés (generatedSummary) des leçons PRÉCÉDENTES du cours, dans l'ordre du
 * cours (section puis position), et tronque au PLUS ANCIEN pour tenir sous
 * CONTINUITY_MAX_CHARS. Retourne `undefined` si aucune leçon précédente n'a de
 * résumé (première leçon, ou résumés absents).
 */
export async function buildContinuityContext(
  courseId: string,
  currentLesson: Pick<ILesson, 'sectionId' | 'order'>,
): Promise<string | undefined> {
  // Ordre global du cours : section.order puis lesson.order. On récupère
  // l'ordre des sections pour comparer une leçon d'une autre section.
  const sections = await Section.find({ courseId }).select('_id order').lean();
  const sectionOrder = new Map(sections.map((s) => [String(s._id), s.order]));
  const currentSectionOrder = sectionOrder.get(String(currentLesson.sectionId)) ?? 0;

  const lessons = await Lesson.find({ courseId })
    .select('sectionId order title generatedSummary status')
    .lean();

  // Filtre : strictement AVANT la leçon courante dans l'ordre global.
  const previous = lessons
    .filter((l) => {
      const so = sectionOrder.get(String(l.sectionId)) ?? 0;
      if (so !== currentSectionOrder) return so < currentSectionOrder;
      return l.order < currentLesson.order;
    })
    .filter((l) => typeof l.generatedSummary === 'string' && l.generatedSummary.trim().length > 0)
    .sort((a, b) => {
      const sa = sectionOrder.get(String(a.sectionId)) ?? 0;
      const sb = sectionOrder.get(String(b.sectionId)) ?? 0;
      return sa === sb ? a.order - b.order : sa - sb;
    });

  // Formatage + troncature au plus ANCIEN délégués à la fonction pure.
  return formatContinuityContext(
    previous.map((l) => ({ title: l.title, generatedSummary: (l.generatedSummary ?? '').trim() })),
  );
}

/**
 * Résume la leçon `lessonId` (2-3 phrases) et stocke le résultat dans
 * Lesson.generatedSummary. En mode mock (MOCK_PROVIDERS ou clé absente), le
 * résumé est dérivé localement des premières phrases du contenu — zéro appel
 * payant. Best-effort : ne jette jamais (un résumé manquant dégrade juste la
 * continuité, sans invalider la leçon).
 */
export async function summarizeLesson(lessonId: string): Promise<string | undefined> {
  try {
    const lesson = await Lesson.findById(lessonId).select('type title summary script');
    if (!lesson) return undefined;

    const content = extractLessonText(lesson);
    const config = getConfig();

    let summary: string;
    if (config.MOCK_PROVIDERS || !config.ANTHROPIC_API_KEY) {
      summary = firstSentences(content);
    } else {
      const result = await callClaudeJson({
        schema: summarySchema,
        system: summarizeSystemPrompt(),
        user: summarizeUserPrompt(lesson.title, content),
        maxTokens: 512,
      });
      summary = result.summary.trim();
    }

    if (!summary) return undefined;
    await Lesson.updateOne({ _id: lessonId }, { $set: { generatedSummary: summary } });
    return summary;
  } catch (err) {
    logger.warn({ lessonId, err }, 'résumé de leçon (continuité) impossible');
    return undefined;
  }
}
