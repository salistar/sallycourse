import type { CourseStatus, Difficulty, LessonType, Locale, VideoQualityStatus } from '@sallycourse/shared';

// Réexports pratiques pour les composants du dossier.
export type { CourseStatus, Difficulty, LessonType, Locale, VideoQualityStatus };

// DTO sérialisables (page serveur → composants clients) de la page détail.
// Les URLs d'assets sont déjà PRÉSIGNÉES côté serveur.

export type LessonStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface LessonAssetsView {
  /** URL présignée de la vidéo (si rendue). */
  videoUrl?: string;
  /** URL présignée de la piste de sous-titres WebVTT. */
  vttUrl?: string;
  /** MP4 vertical 9:16 présigné (P167, format shorts) — si l'option était active. */
  videoVerticalUrl?: string;
  /** Contenu Markdown de l'article (stocké en base). */
  articleMd?: string;
  /**
   * URLs présignées des captures d'écran, ALIGNÉES PAR INDEX sur les étapes
   * du TP (`tpContent.steps[i]` ↔ `screenshots[i]`) — Lot 5, plan 2026-07-20.
   * Une chaîne vide signifie « pas encore de capture pour cette étape »
   * (jamais compactée : un trou au milieu du tableau reste à sa position).
   */
  screenshots: string[];
}

export interface QuizQuestionView {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

/** Slide éditable d'un script vidéo (sous-ensemble édité + champs préservés). */
export interface SlideView {
  template: string;
  title: string;
  bullets: string[];
  narration: string;
  /** Champs de la slide non exposés à l'édition, conservés à l'identique. */
  rest: Record<string, unknown>;
}

/** Étape éditable d'un TP (Lot 5, plan 2026-07-20). */
export interface TpStepView {
  instruction: string;
  command?: string;
  expectedResult: string;
  /** Champs non exposés à l'édition (ex. `screenshotSpec` de la capture automatique), conservés à l'identique. */
  rest: Record<string, unknown>;
}

/** Contenu complet d'un TP (Lot 5, plan 2026-07-20) — miroir de `TpContent` (@sallycourse/shared). */
export interface TpContentView {
  objective: string;
  environment: string[];
  steps: TpStepView[];
  validation: string[];
  troubleshooting: string[];
}

export interface LessonView {
  id: string;
  title: string;
  type: LessonType;
  status: LessonStatus;
  order: number;
  durationMin?: number;
  summary?: string;
  assets: LessonAssetsView;
  /** Questions du quiz associé (null si aucun quiz généré). */
  quiz: QuizQuestionView[] | null;
  /** Slides du script vidéo (leçons 'video' avec script produit). */
  scriptSlides?: SlideView[];
  /** Contenu structuré du TP (leçons 'tp' avec script produit) — Lot 5, plan 2026-07-20. */
  tpContent?: TpContentView;
  /**
   * Cycle brouillon→final de l'aperçu vidéo rapide (Prompt 133) — pertinent
   * uniquement pour les leçons 'video'. Absent/'none' = jamais utilisé.
   */
  videoQualityStatus?: VideoQualityStatus;
}

export interface SectionView {
  id: string;
  title: string;
  order: number;
  lessons: LessonView[];
}

/** Un contrôle unitaire du rapport qualité (Prompt 26). */
export interface QaCheckView {
  code: string;
  ok: boolean;
  detail: string;
}

/** Rapport de contrôle qualité automatique d'un cours (null si jamais exécuté). */
export interface QaReportView {
  passed: boolean;
  ranAt: string;
  checks: QaCheckView[];
}

/** Rubrique détaillée du score de qualité pédagogique (Prompt 94), 0-25 chacun. */
export interface QualityRubricView {
  clarity: number;
  progression: number;
  examples: number;
  engagement: number;
}

/** Score de qualité pédagogique d'un cours (null si jamais évalué). */
export interface QualityScoreView {
  score: number;
  rubric: QualityRubricView;
  feedback: string[];
  evaluatedAt: string;
}

/** Un thème récurrent extrait des avis étudiants (P62). */
export interface ReviewThemeView {
  label: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  count: number;
  quotes: string[];
}

/** Une suggestion d'amélioration ciblée (P62). */
export interface ImprovementSuggestionView {
  /** Titre de la leçon visée, ou null si la suggestion porte sur le cours entier. */
  lessonRef: string | null;
  /** Identifiant de la leçon résolu depuis lessonRef (null si non résolu / global). */
  lessonId: string | null;
  action: string;
  rationale: string;
}

/** Analyse des retours étudiants persistée sur un cours (null si jamais exécutée). */
export interface ReviewFeedbackView {
  themes: ReviewThemeView[];
  suggestions: ImprovementSuggestionView[];
  reviewCount: number;
  averageRating: number;
  generatedAt: string;
}

/** Une entrée du glossaire du cours (P65). */
export interface GlossaryEntryView {
  term: string;
  definition: string;
}

/** Une ressource « pour aller plus loin » (P65). */
export interface FurtherResourceView {
  title: string;
  kind: string;
  url?: string;
  description: string;
}

/**
 * Ressources téléchargeables enrichies (P65) — cheat sheet + workbook PDF
 * (URLs présignées) et contenu structuré (glossaire, ressources). Null tant
 * qu'aucune génération n'a tourné.
 */
export interface CourseResourcesView {
  glossary: GlossaryEntryView[];
  furtherResources: FurtherResourceView[];
  cheatsheetUrl?: string;
  workbookUrl?: string;
  generatedAt: string;
}

/** Réutilisation du contenu (P197/201/202/203) — liens de téléchargement présignés. */
export interface RepurposingView {
  flashcards?: { count: number; jsonUrl?: string; ankiUrl?: string };
  /** Podcast : nombre d'épisodes + flux RSS + épisodes présignés (lecture/téléchargement). */
  podcast?: { count: number; feedUrl?: string; episodes?: { title: string; url: string }[] };
  ebook?: { epubUrl?: string; pdfUrl?: string };
  trailer?: { videoUrl?: string };
}

/** Kit marketing généré (Prompt 28) — textes + visuels présignés. */
export interface MarketingKitView {
  udemyDescription: string;
  promoText: string;
  welcomeMessage: string;
  congratsMessage: string;
  titleIdeas: { title: string; score: number; reason: string }[];
  udemyCoverUrl?: string;
  youtubeThumbnailUrl?: string;
  heroCoverUrl?: string;
}

/** Une version doublée du cours dans une langue cible (Prompt 92). */
export interface DubbedVersionView {
  locale: Locale;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  lessonsWithSubtitles: number;
  lessonsWithVideo: number;
  updatedAt: string;
}

/** Un article du blog SEO du cours (P204) — vue dashboard. */
export interface BlogPostView {
  slug: string;
  title: string;
  keyword: string;
  status: 'draft' | 'scheduled' | 'published';
  /** Échéance de publication (ISO) — date prévue si encore programmé. */
  scheduledFor: string;
  /** Date de publication effective (ISO) — null tant que non publié. */
  publishedAt: string | null;
}

/** Section « Blog SEO » de la page cours (P204). */
export interface CourseBlogView {
  posts: BlogPostView[];
  /** Le cours est publié sur le LMS : la (re)génération du blog est possible. */
  publishedOnLms: boolean;
}

export interface CourseDetailView {
  id: string;
  title: string;
  status: CourseStatus;
  difficulty: Difficulty;
  locale: Locale;
  createdAt: string;
  /**
   * Mode d'enchaînement de la génération — 'validated' affiche le bandeau
   * « Valider et continuer » après chaque leçon générée. Absent = 'auto'.
   */
  generationMode?: 'auto' | 'validated';
  /**
   * Thème visuel du cours (catalogue 2026-07-26) — id de THEME_CATALOG.
   * Absent = « salistar » (défaut). Pilote le panneau « Thème » et le wrapper
   * de variables CSS des articles.
   */
  themeId?: string;
  /** Dernier rapport de révision automatique (2026-07-26) — null si jamais lancée. */
  reviewReport?: {
    startedAt: string;
    finishedAt: string;
    lessonsScanned: number;
    actions: { lessonId: string; lessonTitle: string; type: string; reason: string }[];
  } | null;
  sections: SectionView[];
  /** Rapport QA (Prompt 26) — null tant que le contrôle n'a pas tourné. */
  qaReport?: QaReportView | null;
  /** Score de qualité pédagogique (Prompt 94) — null tant qu'aucune évaluation n'a tourné. */
  qualityScore?: QualityScoreView | null;
  /** Analyse des retours étudiants (P62) — null tant qu'aucune analyse n'a tourné. */
  feedback?: ReviewFeedbackView | null;
  /** Ressources téléchargeables enrichies (P65) — null tant qu'aucune génération n'a tourné. */
  resources?: CourseResourcesView | null;
  /** Réutilisation du contenu (P197/201/202/203) — flashcards/podcast/ebook/trailer. */
  repurposing?: RepurposingView | null;
  /** Kit marketing généré (Prompt 28) — textes + visuels ; null si non généré. */
  marketing?: MarketingKitView | null;
  /** Cours archivé à froid (P79) — affiche un bandeau + bouton Réactiver. */
  archived?: boolean;
  /** Blog SEO du cours (P204) — articles générés à la publication sur le LMS. */
  blog?: CourseBlogView | null;
  /** Versions doublées existantes (P92) — tableau vide tant qu'aucune traduction n'a tourné. */
  dubbedVersions?: DubbedVersionView[];
  /**
   * Rattachement à un Workspace d'équipe (Prompt 138). Présent uniquement si
   * le cours appartient à une équipe — pilote l'affichage des commentaires de
   * leçon et du bandeau d'approbation (absent = cours solo, comportement
   * historique inchangé).
   */
  workspace?: {
    id: string;
    /** Rôle effectif de l'utilisateur courant dans ce workspace. */
    role: 'owner' | 'editor' | 'reviewer';
    /** true si ce workspace a au moins un reviewer (gate d'approbation active). */
    hasReviewer: boolean;
  } | null;
  /** Approbation de la version courante (P138) — null tant que non approuvée. */
  approvedBy?: string | null;
  approvedAt?: string | null;
  /**
   * Mix de providers RÉELLEMENT utilisé pour générer ce cours (Prompt 160,
   * comparateur de coût cloud vs OSS) — undefined tant qu'aucun générateur ne
   * l'a renseigné (cours antérieurs au P160, affiché comme "OSS" par défaut
   * côté composant puisque c'est le comportement par défaut du pipeline).
   */
  providerMix?: { llm: 'oss' | 'cloud'; tts: 'oss' | 'cloud'; image: 'oss' | 'cloud' };
}
