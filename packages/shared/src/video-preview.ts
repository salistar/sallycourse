// Prévisualisation vidéo rapide (Prompt 133) — flow "Aperçu rapide" (draft) →
// "Version finale HD" (final), au-dessus des presets FFmpeg draft/final déjà
// posés par le Prompt 78 (apps/worker/src/media/video-render.ts::PRESET_CONFIG).
// Ce module ne connaît PAS ffmpeg : uniquement la logique PURE de sélection de
// mode et de statut d'approbation, partagée web (API routes) + worker (jobs).
import { z } from 'zod';

/** Mode de génération vidéo demandé par l'utilisateur sur l'écran de génération. */
export const videoPreviewModeSchema = z.enum(['quick-preview', 'final']);
export type VideoPreviewMode = z.infer<typeof videoPreviewModeSchema>;

/**
 * Statut du cycle brouillon→final d'UNE leçon vidéo. Additif sur Lesson :
 * absent/'none' pour tout cours n'ayant jamais utilisé l'aperçu rapide (aucun
 * changement de comportement). 'draft-ready' = aperçu généré, en attente de
 * validation. 'approved' = l'utilisateur a validé, la version finale peut être
 * lancée. 'final-ready' = HD livrée.
 */
export const videoQualityStatusSchema = z.enum([
  'none',
  'draft-ready',
  'approved',
  'final-ready',
]);
export type VideoQualityStatus = z.infer<typeof videoQualityStatusSchema>;

/**
 * Traduit un mode UI en preset d'encodage FFmpeg (cf. RenderPreset côté
 * worker/media/video-render.ts — chaînes volontairement identiques pour éviter
 * une table de correspondance : 'quick-preview' → 'draft', 'final' → 'final').
 * Fonction PURE, aucune dépendance à ffmpeg ni à la base.
 */
export function presetForMode(mode: VideoPreviewMode): 'draft' | 'final' {
  return mode === 'quick-preview' ? 'draft' : 'final';
}

/**
 * Voix TTS effective en mode aperçu rapide : TOUJOURS la voix standard par
 * langue la plus rapide à générer (aucun clonage), même si le cours a une
 * `ttsVoice` clonée configurée — le clonage ajoute de la latence/coût non
 * justifiés pour un brouillon jetable. En mode 'final', la voix du cours
 * (clonée ou non) est utilisée telle quelle. Fonction PURE.
 */
export function ttsVoiceForMode(mode: VideoPreviewMode, courseVoice: string | undefined): string | undefined {
  return mode === 'quick-preview' ? undefined : courseVoice;
}

/**
 * Facteur d'accélération affiché côté UI pour le mode aperçu rapide, dérivé de
 * PRESET_SPEED_FACTOR (worker/media/video-render.ts : draft=3 vs final=1) et
 * du fait que le TTS standard (pas de clonage) est également plus rapide que
 * la voix clonée. Valeur ronde et conservatrice pour la communication produit —
 * ne prétend pas mesurer un ratio exact runtime par runtime.
 */
export const QUICK_PREVIEW_SPEEDUP_LABEL = '5x plus rapide, qualité brouillon';

/**
 * Transition de statut PURE : calcule le nouveau videoQualityStatus d'une
 * leçon selon l'évènement survenu. Ne fait aucune I/O — l'appelant persiste le
 * résultat. Toute transition non reconnue renvoie le statut inchangé (garde-fou,
 * ne doit jamais jeter).
 */
export type VideoQualityEvent = 'draft-rendered' | 'approved' | 'final-rendered' | 'reset';

export function nextVideoQualityStatus(
  current: VideoQualityStatus,
  event: VideoQualityEvent,
): VideoQualityStatus {
  switch (event) {
    case 'draft-rendered':
      return 'draft-ready';
    case 'approved':
      // On ne peut approuver qu'un brouillon déjà rendu.
      return current === 'draft-ready' ? 'approved' : current;
    case 'final-rendered':
      return 'final-ready';
    case 'reset':
      return 'none';
    default:
      return current;
  }
}

/**
 * Une leçon vidéo est éligible au lancement de la version finale HD si son
 * aperçu a été rendu ET approuvé — cf. flow imposé par le prompt : le bouton
 * « Générer la version finale HD » ne doit agir que sur les leçons approuvées.
 * 'final-ready' reste éligible (permet une re-livraison HD après ré-approbation
 * manuelle, ex. après une édition de script qui repasse la leçon en draft-ready).
 */
export function isEligibleForFinal(status: VideoQualityStatus): boolean {
  return status === 'approved' || status === 'final-ready';
}

/**
 * Répartit un ensemble de leçons vidéo entre celles à traiter et celles
 * ignorées pour un évènement de lancement donné ('quick-preview' traite TOUTES
 * les leçons vidéo d'un coup ; 'final' ne traite que les leçons approuvées).
 * Fonction PURE — l'appelant fournit déjà la liste des leçons vidéo du cours.
 */
export interface VideoLessonQualityInput {
  lessonId: string;
  videoQualityStatus?: VideoQualityStatus;
}

export function selectLessonsForMode(
  lessons: readonly VideoLessonQualityInput[],
  mode: VideoPreviewMode,
): string[] {
  if (mode === 'quick-preview') {
    return lessons.map((l) => l.lessonId);
  }
  return lessons
    .filter((l) => isEligibleForFinal(l.videoQualityStatus ?? 'none'))
    .map((l) => l.lessonId);
}
