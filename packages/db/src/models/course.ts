// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// Import sur une seule ligne : le @ts-ignore neutralise TS6059/TS2305 quand ce
// fichier est consommé en source par le worker (NodeNext) ; typage intact ici (Bundler).
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext)
import { LOCALES, courseStatusSchema, difficultySchema, outlineSchema, type CourseStatus, type Difficulty, type Locale, type Outline } from '@sallycourse/shared';

export interface ICourse {
  userId: Types.ObjectId;
  title: string;
  difficulty: Difficulty;
  status: CourseStatus;
  /** Plan de cours — Mixed en base mais validé par outlineSchema (Zod). */
  outline?: Outline | null;
  targetPlatforms: string[];
  locale: Locale;
  /** Filigrane discret exigé selon le plan à la création (free=true) — P53. */
  watermark: boolean;
  ttsVoice?: string;
  /**
   * Vitesse de narration configurable (Prompt 137, accessibilité) : 1 =
   * débit standard (AUDIO.NARRATION_WORDS_PER_MINUTE), plage 0.75–1.25
   * répercutée sur le TTS (media/tts.ts). Additif, undefined = défaut 1
   * (comportement inchangé pour tous les cours existants).
   */
  narrationSpeed?: number;
  coverImageUrl?: string;
  /** Clé S3 de la vidéo d'intro webcam (~60 s) — mode compliance max Udemy (P48). */
  introVideoKey?: string;
  qaReport?: unknown;
  /**
   * Score de qualité pédagogique (Prompt 94) : {score:0-100, rubric:{clarity,
   * progression, examples, engagement}, feedback:string[], evaluatedAt}.
   * Mixed en base, validé par qualityScoreSchema (Zod) côté @sallycourse/shared.
   * Null tant qu'aucune évaluation n'a tourné. Sert de garde-fou (contournable)
   * avant tout déploiement Udemy.
   */
  qualityScore?: unknown;
  /** Landing marketing générée (JSON marketingSchema + clés S3 des visuels) — Mixed. */
  marketing?: unknown;
  /**
   * Analyse des retours étudiants (P62) : thèmes récurrents + suggestions
   * d'amélioration ciblées, produites par le worker à partir des avis Udemy.
   * Mixed en base, validé par reviewAnalysisSchema (Zod). Null tant qu'aucune
   * analyse n'a tourné.
   */
  improvementSuggestions?: unknown;
  /**
   * Mention IA générée acceptée par l'auteur (P66, RGPD/légal) — case à
   * cocher OBLIGATOIRE avant tout déploiement vers Udemy (transparence
   * contenu généré par IA). Bloque le déploiement udemy tant que false.
   */
  aiDisclosureAccepted: boolean;
  /**
   * Ressources téléchargeables enrichies (P65) : cheat sheet PDF, workbook PDF,
   * glossaire et liste « pour aller plus loin », générées en fin de pipeline.
   * Mixed en base (clés S3 + statut) ; null tant qu'aucune génération n'a tourné.
   */
  resources?: unknown;
  /**
   * Archivage à froid (P79) : true si le cours est inactif depuis 90+ jours
   * (voir lib/retention.ts côté worker). Un cours archivé reste consultable
   * mais est exclu des listings actifs ; réactivable via
   * POST /api/courses/[id]/reactivate (ré-enqueue depuis Lesson.script, sans
   * rappel LLM). Champ additif, default false — ne modifie aucun comportement
   * existant pour les cours jamais archivés.
   */
  archived?: boolean;
  /** Date de bascule en archivé (null si jamais archivé ou réactivé). */
  archivedAt?: Date | null;
  /**
   * Avatar vidéo « talking head » (Prompt 82, bêta) — insère un segment avatar
   * généré (HeyGen, ou repli carte titre animée en mock) en intro/conclusion de
   * chaque section. Additif, défaut false : aucun changement pour les cours
   * existants tant que non activé explicitement (toggle options avancées).
   */
  avatarEnabled?: boolean;
  /** Identifiant d'avatar HeyGen choisi (ignoré si avatarEnabled=false). */
  avatarId?: string;
  /**
   * Opt-in explicite de l'auteur (Prompt 89) : autorise l'affichage de ce
   * cours sur la vitrine publique /showcase (titre, difficulté, éventuel
   * témoignage). Additif, défaut false : aucun cours n'apparaît sans action
   * volontaire de son auteur.
   */
  showcaseOptIn?: boolean;
  /**
   * Import de contenu existant (Prompt 90, RAG simple) : true si l'utilisateur
   * a fourni au moins un support source (PDF/PPTX/Markdown) exploité pour
   * générer le plan. Signal utilisé par le mode compliance Udemy (P48) —
   * contenu moins suspect de générique quand basé sur du matériel fourni.
   * Additif, défaut false : aucun changement pour les cours existants.
   */
  sourceMaterial?: boolean;
  /**
   * Descripteurs des fichiers source importés (Mixed, validé par
   * sourceMaterialFilesSchema côté @sallycourse/shared) — clé S3, nom,
   * type, taille. Null tant qu'aucun import n'a eu lieu.
   */
  sourceMaterialFiles?: unknown;
  /**
   * Suggestions de mise à jour du cours (Prompt 91) : détection périodique
   * (cron trimestriel) de sujets probablement obsolètes, produite par
   * detectOutdatedTopics (raisonnement du LLM sur ses connaissances, PAS de
   * recherche web réelle — voir lib/course-refresh.ts côté worker). Mixed en
   * base, validée par refreshSuggestionsSchema (Zod, @sallycourse/shared).
   * Null tant qu'aucune détection n'a tourné. N'entraîne JAMAIS de
   * régénération automatique — l'utilisateur déclenche la mise à jour leçon
   * par leçon depuis l'UI (bouton « Mettre à jour », réutilise le mécanisme
   * de régénération existant POST /api/lessons/[id]/regenerate).
   */
  refreshSuggestions?: unknown;
  /**
   * Versions doublées du cours (Prompt 92, traduction des cours publiés) :
   * une entrée par langue cible avec doublage activé — sous-titres traduits +
   * vidéos ré-assemblées (nouveau TTS via tts.ts + nouveau MP4 via
   * video-render.ts, cf. lib/translate-published.ts côté worker). Additif,
   * tableau vide par défaut : aucun effet sur les cours existants tant
   * qu'aucune traduction avec doublage n'a été lancée. Au plus une entrée par
   * locale (une nouvelle génération remplace l'entrée existante de cette locale).
   */
  dubbedVersions?: IDubbedVersion[];
  /**
   * Musique de fond (Prompt 135, habillage sonore) : id d'une piste du
   * catalogue MUSIC_CATALOG (@sallycourse/shared/music-catalog) ou du jingle
   * SALISTAR (JINGLE_TRACK_ID). Additif, undefined par défaut : aucun
   * changement pour les cours existants tant que non choisi explicitement.
   * Le mixage (video-render.ts) SKIP proprement si le fichier MP3 correspondant
   * n'est pas présent dans le stockage (cf. background-music.ts).
   */
  backgroundMusicId?: string;
  /** Volume linéaire de la musique de fond (0-1) — défaut MUSIC_MIX.DEFAULT_VOLUME si absent. */
  musicVolume?: number;
  /**
   * Jingle SALISTAR par défaut en tête/fin de vidéo (Prompt 135) — même
   * mécanisme optionnel que backgroundMusicId (fichier absent → skip). Additif,
   * défaut false.
   */
  jingleEnabled?: boolean;
  /**
   * Rattachement optionnel à un Workspace d'équipe (Prompt 138, plan Business).
   * Additif : absent → cours resté lié à son seul userId (comportement
   * inchangé, rétrocompatible avec tous les cours existants).
   */
  workspaceId?: Types.ObjectId | null;
  /**
   * Gate d'approbation d'équipe (P138) : si le Workspace du cours a au moins
   * un reviewer, le déploiement exige qu'un reviewer ait approuvé CETTE
   * version avant de pouvoir être lancé. approvedBy = membre reviewer/owner
   * ayant validé ; null tant qu'aucune approbation. Une nouvelle génération
   * de contenu significative devrait réinitialiser ces deux champs côté
   * appelant (non automatique ici, pour rester additif et non intrusif).
   */
  approvedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;
  /**
   * Mode agence (Prompt 150) : cours généré/déployé au nom d'un client tiers
   * (AgencyClient), par un utilisateur agence (User.isAgency=true). Le
   * userId ci-dessus reste celui de l'AGENCE (compte facturé/quota) — seuls
   * les déploiements basculent sur les PlatformCredential du CLIENT référencé
   * par ce champ (voir resolveAgencyDeployCredentials, @sallycourse/shared).
   * Additif, absent = cours normal (comportement inchangé).
   */
  agencyClientId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Une déclinaison doublée du cours dans une langue cible : sous-titres et
 * vidéos régénérés, indexés par leçon (même ordre que Lesson.order, un
 * élément par leçon vidéo du cours — chaîne vide tant que cette leçon n'a pas
 * encore été traitée). `status` suit le cycle de vie de la génération,
 * best-effort et jamais bloquant pour le cours source.
 */
export interface IDubbedVersion {
  locale: Locale;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  /** Clé S3 du .srt traduit par leçon (index = ordre absolu de la leçon). */
  srtKeys: string[];
  /** Clé S3 du .mp4 doublé par leçon (chaîne vide tant que non généré). */
  videoKeys: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type CourseDocument = HydratedDocument<ICourse>;

const courseSchema = new Schema<ICourse>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    difficulty: { type: String, enum: [...difficultySchema.options], required: true },
    status: { type: String, enum: [...courseStatusSchema.options], default: 'draft' },
    outline: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (v: unknown) => v == null || outlineSchema.safeParse(v).success,
        message: 'outline invalide (ne respecte pas outlineSchema)',
      },
    },
    targetPlatforms: { type: [String], default: [] },
    locale: { type: String, enum: [...LOCALES], default: 'fr' },
    watermark: { type: Boolean, default: true },
    ttsVoice: { type: String },
    narrationSpeed: { type: Number, min: 0.75, max: 1.25 },
    coverImageUrl: { type: String },
    introVideoKey: { type: String },
    qaReport: { type: Schema.Types.Mixed, default: null },
    qualityScore: { type: Schema.Types.Mixed, default: null },
    marketing: { type: Schema.Types.Mixed, default: null },
    improvementSuggestions: { type: Schema.Types.Mixed, default: null },
    aiDisclosureAccepted: { type: Boolean, default: false },
    resources: { type: Schema.Types.Mixed, default: null },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    avatarEnabled: { type: Boolean, default: false },
    avatarId: { type: String },
    showcaseOptIn: { type: Boolean, default: false },
    sourceMaterial: { type: Boolean, default: false },
    sourceMaterialFiles: { type: Schema.Types.Mixed, default: null },
    refreshSuggestions: { type: Schema.Types.Mixed, default: null },
    backgroundMusicId: { type: String },
    musicVolume: { type: Number },
    jingleEnabled: { type: Boolean, default: false },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    agencyClientId: { type: Schema.Types.ObjectId, ref: 'AgencyClient', default: null, index: true },
    dubbedVersions: {
      type: [
        new Schema<IDubbedVersion>(
          {
            locale: { type: String, enum: [...LOCALES], required: true },
            status: {
              type: String,
              enum: ['pending', 'generating', 'ready', 'failed'],
              default: 'pending',
            },
            srtKeys: { type: [String], default: [] },
            videoKeys: { type: [String], default: [] },
            createdAt: { type: Date, default: Date.now },
            updatedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  // optimisticConcurrency (P120) : incrémente __v à chaque save() et rejette
  // (VersionError) une sauvegarde basée sur une version déjà obsolète — protège
  // contre deux jobs qui chargent puis ré-écrivent le même Course en parallèle
  // (course-refresh, feedback-loop, translate-published, outline-generation).
  // Les mutations atomiques (updateOne/findOneAndUpdate déjà utilisées ailleurs
  // dans le pipeline) ne sont pas concernées : seul le couple load→save profite
  // du verrou. Voir apps/worker/src/lib/concurrency.ts pour le retry associé.
  { timestamps: true, optimisticConcurrency: true },
);

// Listing des cours d'un utilisateur, du plus récent au plus ancien.
courseSchema.index({ userId: 1, createdAt: -1 });

// Recherche globale (P132) : index texte natif Mongo sur le titre — pas
// d'Elasticsearch/Meilisearch avant Phase 9 OSS. Additif, ne remplace aucun
// index existant.
courseSchema.index({ title: 'text' }, { name: 'course_text_search' });

export const Course: Model<ICourse> =
  (mongoose.models.Course as Model<ICourse> | undefined) ?? model<ICourse>('Course', courseSchema);
