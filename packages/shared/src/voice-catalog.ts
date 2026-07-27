// Catalogue de voix de narration (fix « voix multiples » 2026-07-26).
//
// Problème constaté en production : une même vidéo pouvait mélanger PLUSIEURS
// voix — la cascade TTS (media/tts.ts) choisit un moteur PAR SLIDE, et chaque
// moteur (Chatterbox, Qwen3-TTS, Edge, Piper…) a son propre timbre par défaut :
// un échec ponctuel du moteur premium sur une slide (cold start GPU, timeout)
// suffisait à insérer une voix étrangère au milieu de la leçon.
//
// Solution : un catalogue de voix dont l'IDENTITÉ SOURCE est une voix
// neuronale Edge stable. Pour chaque voix du catalogue :
//   - un échantillon de référence est synthétisé une fois via Edge puis mis en
//     cache storage (voice-catalog/{id}.wav) ;
//   - les moteurs premium (Chatterbox, Qwen3-TTS) reçoivent cet échantillon en
//     audio_prompt (clonage) → ils reproduisent la MÊME identité vocale ;
//   - le repli Edge utilise directement la voix source (identité identique par
//     construction).
// Résultat : quelle que soit la slide et quel que soit le moteur qui a
// réellement produit l'audio, la voix perçue est la même — dans la vidéo et
// dans tout le cours. Un garde de cohérence par leçon (tts-generation.ts)
// reconverge en plus les slides minoritaires vers le moteur majoritaire.
//
// Additif : Course.voiceId absent → voix par défaut de la langue du cours
// (identique aux défauts Edge historiques — aucun changement d'identité pour
// les cours existants régénérés).

export interface CatalogVoice {
  /** Identifiant stable (Course.voiceId). */
  id: string;
  /** Nom d'affichage neutre (identique dans les 3 langues d'interface). */
  name: string;
  gender: 'female' | 'male';
  /** Langues conseillées (affichage/tri UI) — la voix reste utilisable partout. */
  locales: string[];
  /** Voix neuronale Edge = identité source (échantillon + repli Edge). */
  edgeVoice: string;
  /** Texte de l'échantillon de référence (langue native de la voix). */
  sampleText: string;
}

const SAMPLE_FR =
  "Bonjour et bienvenue dans cette formation. Ensemble, nous allons découvrir des notions essentielles, " +
  "étape par étape, avec des exemples concrets et des exercices pratiques. Prenez le temps d'écouter, " +
  "de tester, et surtout, avancez à votre rythme : c'est la meilleure façon d'apprendre durablement.";
const SAMPLE_EN =
  "Hello and welcome to this course. Together, we will explore the key concepts step by step, " +
  "with concrete examples and hands-on exercises. Take your time, practice as you go, " +
  "and move at your own pace: that is the best way to learn something that truly lasts.";
const SAMPLE_AR =
  "مرحبا بكم في هذه الدورة التدريبية. سوف نكتشف معا المفاهيم الأساسية خطوة بخطوة، " +
  "مع أمثلة عملية وتمارين تطبيقية. خذوا وقتكم في الاستماع والتجربة، وتقدموا حسب إيقاعكم الخاص، " +
  "فهذه هي أفضل طريقة للتعلم العميق والمستدام.";

/**
 * Les huit voix du catalogue. Les ids sont STABLES (clés de cache TTS,
 * Course.voiceId persistés) — ne jamais les renommer, seulement en ajouter.
 */
export const VOICE_CATALOG: CatalogVoice[] = [
  { id: 'claire', name: 'Claire', gender: 'female', locales: ['fr'], edgeVoice: 'fr-FR-DeniseNeural', sampleText: SAMPLE_FR },
  { id: 'henri', name: 'Henri', gender: 'male', locales: ['fr'], edgeVoice: 'fr-FR-HenriNeural', sampleText: SAMPLE_FR },
  { id: 'vivienne', name: 'Vivienne', gender: 'female', locales: ['fr', 'en'], edgeVoice: 'fr-FR-VivienneMultilingualNeural', sampleText: SAMPLE_FR },
  { id: 'remy', name: 'Rémy', gender: 'male', locales: ['fr', 'en'], edgeVoice: 'fr-FR-RemyMultilingualNeural', sampleText: SAMPLE_FR },
  { id: 'aria', name: 'Aria', gender: 'female', locales: ['en'], edgeVoice: 'en-US-AriaNeural', sampleText: SAMPLE_EN },
  { id: 'andrew', name: 'Andrew', gender: 'male', locales: ['en', 'fr'], edgeVoice: 'en-US-AndrewMultilingualNeural', sampleText: SAMPLE_EN },
  { id: 'zariyah', name: 'Zariyah', gender: 'female', locales: ['ar'], edgeVoice: 'ar-SA-ZariyahNeural', sampleText: SAMPLE_AR },
  { id: 'hamed', name: 'Hamed', gender: 'male', locales: ['ar'], edgeVoice: 'ar-SA-HamedNeural', sampleText: SAMPLE_AR },
];

/** Ids valides (validation zod côté API). */
export const VOICE_CATALOG_IDS = VOICE_CATALOG.map((v) => v.id) as [string, ...string[]];

/**
 * Voix par défaut par langue de cours — volontairement identiques aux défauts
 * Edge historiques (EDGE_TTS_DEFAULT_VOICES) : un cours existant sans voiceId
 * garde exactement la même identité vocale qu'avant ce correctif.
 */
const DEFAULT_VOICE_BY_LOCALE: Record<string, string> = {
  fr: 'claire',
  en: 'aria',
  ar: 'zariyah',
};

/** Voix du catalogue par id — undefined si inconnu (tolérant aux données legacy). */
export function getCatalogVoice(voiceId: string | undefined | null): CatalogVoice | undefined {
  if (!voiceId) return undefined;
  return VOICE_CATALOG.find((v) => v.id === voiceId);
}

/**
 * Voix effective d'un cours : voiceId s'il est valide, sinon défaut de la
 * langue (fr si langue inconnue). Fonction PURE — utilisée par le worker
 * (épinglage de l'échantillon) et par l'UI (présélection).
 */
export function resolveCatalogVoice(voiceId: string | undefined | null, locale: string): CatalogVoice {
  const chosen = getCatalogVoice(voiceId);
  if (chosen) return chosen;
  const fallbackId = DEFAULT_VOICE_BY_LOCALE[locale] ?? DEFAULT_VOICE_BY_LOCALE.fr!;
  return getCatalogVoice(fallbackId)!;
}
