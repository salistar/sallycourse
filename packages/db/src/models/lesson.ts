// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { lessonTypeSchema, videoQualityStatusSchema, type LessonType, type VideoQualityStatus } from '@sallycourse/shared';

export const LESSON_STATUSES = ['pending', 'generating', 'ready', 'failed'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/**
 * Liens vers un projet interactif ouvrable dans un IDE en ligne (P84), pour
 * une leçon TP dont le langage a été détecté. Deux variantes distinctes :
 * code de départ (exercice à compléter) et solution (code final).
 */
export interface ISandboxProjectLinks {
  stackblitzUrl: string;
  codesandboxUrl: string;
}

export interface ISandboxLinks {
  /** Langage détecté ayant servi à choisir le template (ex: 'javascript', 'python'). */
  language: string;
  starter: ISandboxProjectLinks;
  solution: ISandboxProjectLinks;
  generatedAt: Date;
}

export interface ILessonAssets {
  videoUrl?: string;
  /** Version verticale 9:16 (P167) — présente si advancedParams.generateVertical. */
  videoVerticalUrl?: string;
  articleMd?: string;
  screenshots: string[];
  /**
   * Index (dans `screenshots[]`) des captures produites en mode DÉGRADÉ —
   * carton de repli, PAS une vraie capture (correctif N2, audit 2026-07-20 :
   * ce flag existait déjà côté worker mais n'était jamais persisté nulle
   * part, rendant l'ampleur du problème invisible côté QA/UI). Additif, vide
   * par défaut.
   */
  screenshotsDegraded?: number[];
  /** Clés S3 des slides vidéo rendues en PNG (gabarits D7, ordre du script). */
  slides: string[];
  srtUrl?: string;
  vttUrl?: string;
  /** Transcription texte brut (P137, accessibilité) — sans timestamps. */
  txtUrl?: string;
  audioUrl?: string;
  /** Liens StackBlitz/CodeSandbox pour les TP de code (P84). */
  sandboxLinks?: ISandboxLinks;
  /**
   * Clés S3 des screencasts (Prompt 85) : mini-vidéos de démonstration par
   * étape de TP (zoom + narration synchronisée), ordre des steps du script.
   * Additif — absent/vide pour toute leçon sans étape en mode screencast.
   */
  screencasts?: string[];
  /**
   * Rendu d'une capture d'écran UPLOADÉE par l'auteur (Feature B) : statut du
   * pipeline asynchrone (upload → narration TTS → composition ffmpeg). 'idle'
   * (défaut) tant qu'aucun rendu n'a été demandé ; 'pending'/'rendering' pendant
   * le traitement ; 'ready' avec `screencastRenderKey` posé ; 'failed' sinon.
   * Additif — distinct du flux screencast AUTOMATIQUE (`screencasts[]`).
   */
  screencastStatus?: ScreencastRenderStatus;
  /** Clé S3 du MP4 final narré+légendé (présent quand screencastStatus='ready'). */
  screencastRenderKey?: string;
  /** Copie des légendes horodatées saisies par l'auteur (pour rechargement UI). */
  screencastOverlays?: unknown;
  /**
   * Statut du bouton « Réparer l'audio » (Lot 2, plan 2026-07-20) : 'idle'
   * (défaut) tant qu'aucune réparation n'a été demandée ; 'pending'/'running'
   * pendant le traitement (diagnostic + resynthèse ciblée ou débruitage) ;
   * 'ready' avec `audioRepairReport` posé ; 'failed' sinon. Additif.
   */
  audioRepairStatus?: AudioRepairStatus;
  /** Dernier rapport de réparation audio (résumé humain + détail machine). */
  audioRepairReport?: IAudioRepairReport;
  /**
   * Moteur de voix ayant produit la narration ACTUELLE de cette leçon (audit
   * qualité modèles 2026-07-22, additif) : posé au premier rendu (copie de
   * Course.ttsEngine) puis mis à jour par le bouton « switch » de audio-repair
   * (mode 'switch-voice') — peut donc diverger du défaut du cours si l'auteur
   * a basculé CETTE leçon vers l'autre moteur. Absent = 'chatterbox' (défaut
   * historique, comportement inchangé pour toute leçon générée avant cet ajout).
   */
  ttsEngine?: 'chatterbox' | 'qwen3';
}

/** Statuts du pipeline de réparation audio (Lot 2). */
export const AUDIO_REPAIR_STATUSES = ['idle', 'pending', 'running', 'ready', 'failed'] as const;
export type AudioRepairStatus = (typeof AUDIO_REPAIR_STATUSES)[number];

/** Rapport d'une exécution de réparation audio (Lot 2, plan 2026-07-20 ; 'switch-voice' additif 2026-07-22). */
export interface IAudioRepairReport {
  mode: 'resynth' | 'denoise' | 'switch-voice';
  ranAt: Date;
  /** Nombre de trous de silence internes détectés (mode resynth uniquement). */
  gapsFound?: number;
  /** Index (0-based) des slides effectivement re-synthétisées (mode resynth/switch-voice). */
  slidesRepaired?: number[];
  /** Message d'erreur si audioRepairStatus='failed'. */
  error?: string;
  /** Moteur cible du basculement (mode 'switch-voice' uniquement). */
  targetEngine?: 'chatterbox' | 'qwen3';
}

/** Statuts du rendu de capture uploadée (Feature B). */
export const SCREENCAST_RENDER_STATUSES = ['idle', 'pending', 'rendering', 'ready', 'failed'] as const;
export type ScreencastRenderStatus = (typeof SCREENCAST_RENDER_STATUSES)[number];

/**
 * Entrée d'historique de version d'une leçon (P46) : trace chaque contenu
 * diffusable produit (empreinte + date), pour suivre les régénérations et
 * proposer la mise à jour des plateformes déjà déployées.
 */
export interface ILessonVersion {
  /** Empreinte du contenu diffusable (== lessonContentHash côté worker). */
  contentHash: string;
  createdAt: Date;
  /** Note libre (« régénération article », « édition script »…). */
  note?: string;
}

/**
 * Avertissement de similarité de contenu (P115) : posé quand cette leçon
 * ressemble fortement (score Jaccard n-grams >= seuil) à une autre leçon du
 * même cours déjà générée. Additif, alerte seulement — n'empêche jamais la
 * génération ni le déploiement.
 */
export interface ILessonSimilarityWarning {
  /** Leçon comparée (déjà générée) jugée quasi-identique. */
  similarToLessonId: Types.ObjectId;
  /** Score de similarité 0-1 (compareSimilarity, worker/lib/content-similarity). */
  score: number;
  detectedAt: Date;
}

export interface ILesson {
  sectionId: Types.ObjectId;
  courseId: Types.ObjectId;
  order: number;
  title: string;
  type: LessonType;
  status: LessonStatus;
  durationMin?: number;
  summary?: string;
  /**
   * Résumé 2-3 phrases du contenu RÉELLEMENT généré (P19), produit après la
   * génération de la leçon. Sert de contexte de continuité aux leçons suivantes
   * (rappels « comme vu dans… », anti-répétition). Distinct de `summary`, qui
   * vient de l'outline avant génération.
   */
  generatedSummary?: string;
  /** Script de génération (structure libre, produite par le worker). */
  script?: unknown;
  assets: ILessonAssets;
  /** Hash du contenu source — évite de regénérer un asset identique. */
  contentHash?: string;
  /** Historique des versions de contenu (P46, ordre chronologique). */
  versions?: ILessonVersion[];
  /** Avertissement de similarité de contenu (P115), additif — absent si RAS. */
  similarityWarning?: ILessonSimilarityWarning;
  /**
   * Score d'originalité 0-1 (P141, worker/lib/plagiarism-check.ts) — vérification
   * best-effort par recherche web de phrases distinctives, PAS une garantie
   * légale. Additif, absent tant qu'aucune vérification n'a encore tourné.
   */
  originalityScore?: number;
  /**
   * Cycle brouillon→final de la prévisualisation vidéo rapide (Prompt 133) :
   * 'none' (défaut) tant que jamais rendue via le flow aperçu ; 'draft-ready'
   * après un rendu preset='draft' ; 'approved' quand l'utilisateur valide le
   * brouillon ; 'final-ready' après le rendu HD. Uniquement pertinent pour les
   * leçons de type 'video' — ignoré pour les autres types. Additif, ne change
   * rien au flow de rendu vidéo historique (sans mode) qui laisse ce champ à
   * 'none'.
   */
  videoQualityStatus?: VideoQualityStatus;
}

export type LessonDocument = HydratedDocument<ILesson>;

const lessonSchema = new Schema<ILesson>({
  sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
  courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
  order: { type: Number, required: true, min: 0 },
  title: { type: String, required: true, trim: true },
  type: { type: String, enum: [...lessonTypeSchema.options], required: true },
  status: { type: String, enum: [...LESSON_STATUSES], default: 'pending' },
  durationMin: { type: Number, min: 0 },
  summary: { type: String },
  generatedSummary: { type: String },
  script: { type: Schema.Types.Mixed, default: null },
  assets: {
    videoUrl: { type: String },
    videoVerticalUrl: { type: String },
    articleMd: { type: String },
    screenshots: { type: [String], default: [] },
    screenshotsDegraded: { type: [Number], default: undefined },
    slides: { type: [String], default: [] },
    srtUrl: { type: String },
    vttUrl: { type: String },
    txtUrl: { type: String },
    audioUrl: { type: String },
    sandboxLinks: {
      type: new Schema<ISandboxLinks>(
        {
          language: { type: String, required: true },
          starter: {
            stackblitzUrl: { type: String, required: true },
            codesandboxUrl: { type: String, required: true },
          },
          solution: {
            stackblitzUrl: { type: String, required: true },
            codesandboxUrl: { type: String, required: true },
          },
          generatedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      default: undefined,
    },
    screencasts: { type: [String], default: undefined },
    screencastStatus: { type: String, enum: [...SCREENCAST_RENDER_STATUSES], default: undefined },
    screencastRenderKey: { type: String },
    screencastOverlays: { type: Schema.Types.Mixed, default: undefined },
    audioRepairStatus: { type: String, enum: [...AUDIO_REPAIR_STATUSES], default: undefined },
    audioRepairReport: {
      type: new Schema<IAudioRepairReport>(
        {
          mode: { type: String, enum: ['resynth', 'denoise', 'switch-voice'], required: true },
          ranAt: { type: Date, required: true },
          gapsFound: { type: Number },
          slidesRepaired: { type: [Number], default: undefined },
          error: { type: String },
          targetEngine: { type: String, enum: ['chatterbox', 'qwen3'] },
        },
        { _id: false },
      ),
      default: undefined,
    },
    ttsEngine: { type: String, enum: ['chatterbox', 'qwen3'] },
  },
  contentHash: { type: String },
  versions: {
    type: [
      new Schema<ILessonVersion>(
        {
          contentHash: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
          note: { type: String },
        },
        { _id: false },
      ),
    ],
    default: [],
  },
  similarityWarning: {
    type: new Schema<ILessonSimilarityWarning>(
      {
        similarToLessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
        score: { type: Number, required: true, min: 0, max: 1 },
        detectedAt: { type: Date, default: Date.now },
      },
      { _id: false },
    ),
    default: undefined,
  },
  originalityScore: { type: Number, min: 0, max: 1 },
  videoQualityStatus: {
    type: String,
    enum: [...videoQualityStatusSchema.options],
    default: 'none',
  },
});

lessonSchema.index({ sectionId: 1, order: 1 });

// Recherche globale (P132) : index texte natif Mongo (titre + résumé) —
// additif, ne remplace aucun index existant.
lessonSchema.index({ title: 'text', summary: 'text' }, { name: 'lesson_text_search' });

export const Lesson: Model<ILesson> =
  (mongoose.models.Lesson as Model<ILesson> | undefined) ?? model<ILesson>('Lesson', lessonSchema);
