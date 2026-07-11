// Contrats du module de déploiement (Prompt 31).
// Un adapter encapsule la publication d'un cours sur une plateforme cible
// (Udemy, YouTube…). Le flow générique — authenticate → createCourse →
// uploadLesson* → setLandingPage → submitForReview → getStatus — est piloté
// par le processor et la classe de base (base-adapter.ts). Chaque plateforme
// n'implémente que ses spécificités.

import type { Logger } from 'pino';
import type {
  DeploymentDocument,
  DeploymentMode,
  DeploymentStatus,
  ICourse,
  ILesson,
  ISection,
} from '../shared.js';

/** Credentials plateforme déjà DÉCHIFFRÉS (jamais persistés en clair). */
export type DeployCredentials = Record<string, string>;

/** Point de reprise : leçon en cours + étape logique du flow. */
export interface DeployCheckpoint {
  /** Index (0-based) de la prochaine leçon à uploader. */
  lessonIndex: number;
  /** Étape logique atteinte (authenticate, createCourse, upload, review…). */
  step: string;
}

/** Signature bornée de publishProgress (courseId + step figés par le processor). */
export type BoundPublishProgress = (
  progress: number,
  message: string,
  level?: 'info' | 'warn' | 'error',
) => Promise<void>;

/**
 * Contexte passé à chaque méthode de l'adapter. Immuable côté données de cours ;
 * `externalId` et `checkpoint` sont renseignés au fil du flow.
 */
export interface DeployContext {
  /** Plateforme cible. */
  platform: string;
  /** Mode d'exécution (auto = sans intervention, assisted, manual). */
  mode: DeploymentMode;
  /** Cours à publier. */
  course: ICourse;
  /** Sections triées par ordre. */
  sections: ISection[];
  /** Leçons triées par ordre (index absolu = position d'upload). */
  lessons: ILesson[];
  /** Credentials déchiffrés (vide en mock). */
  credentials: DeployCredentials;
  /**
   * Identifiant du compte plateforme (PlatformCredential) utilisé — multi-comptes
   * (P49). Sert à ISOLER les sessions Playwright par compte (storageState distinct
   * par credentialId). Vide si aucun compte résolu (mode simulé).
   */
  credentialId?: string;
  /** Point de reprise courant (lu/écrit sur le Deployment). */
  checkpoint: DeployCheckpoint;
  /** Identifiant du cours côté plateforme (renseigné par createCourse). */
  externalId?: string;
  /** Progression bornée (courseId + step 'deployment' pré-remplis). */
  publishProgress: BoundPublishProgress;
  /** Logger structuré (pino). */
  logger: Logger;
  /** true → aucun appel réseau réel (statuts/URL fictifs, logs « [mock] »). */
  mock: boolean;
  /** Document Deployment sous-jacent (checkpoint/logs/status persistés). */
  deployment: DeploymentDocument;
}

/** Statut renvoyé par getStatus (agrège l'état plateforme). */
export interface DeployStatus {
  status: DeploymentStatus;
  externalUrl?: string;
  /** État de revue côté plateforme (in_review, approved, rejected…). */
  reviewState?: string;
}

/** Résultat final du flow de déploiement (retour du processor). */
export interface DeployResult {
  platform: string;
  status: DeploymentStatus;
  externalId?: string;
  externalUrl?: string;
  reviewState?: string;
  /** Nombre de leçons effectivement uploadées durant cette exécution. */
  lessonsUploaded: number;
}

/**
 * Contrat d'un adapter de déploiement. Les méthodes sont appelées dans l'ordre
 * du flow par le processor ; uploadLesson est invoquée une fois par leçon (le
 * checkpoint permet la reprise sans ré-uploader les leçons déjà traitées).
 */
export interface DeploymentAdapter {
  /** Nom de la plateforme (clé du registre : 'udemy', 'youtube'…). */
  platform: string;
  /** Capacités déclarées (modes supportés, besoin d'un navigateur headless). */
  capabilities: {
    modes: DeploymentMode[];
    needsBrowser: boolean;
  };
  /** Ouvre/valide la session plateforme (login, OAuth, jeton…). */
  authenticate(ctx: DeployContext): Promise<void>;
  /** Crée le cours côté plateforme ; retourne son identifiant externe. */
  createCourse(ctx: DeployContext): Promise<{ externalId: string }>;
  /** Uploade une leçon (index absolu dans ctx.lessons). */
  uploadLesson(ctx: DeployContext, lesson: ILesson, index: number): Promise<void>;
  /**
   * Met à jour une leçon DÉJÀ déployée (P46) : re-upload ciblé de la seule
   * vidéo/asset modifié. Optionnel — si l'adapter ne l'implémente pas, le
   * processor retombe sur `uploadLesson` (remplacement complet de la leçon).
   */
  updateLesson?(ctx: DeployContext, lesson: ILesson, index: number): Promise<void>;
  /** Renseigne la page de présentation (landing) du cours. */
  setLandingPage(ctx: DeployContext): Promise<void>;
  /** Soumet le cours à la revue/publication de la plateforme. */
  submitForReview(ctx: DeployContext): Promise<void>;
  /** Interroge l'état courant côté plateforme. */
  getStatus(ctx: DeployContext): Promise<DeployStatus>;
  /**
   * Ajoute/remplace les sous-titres (.srt) d'une leçon DÉJÀ déployée, dans une
   * langue donnée (P92, traduction des cours publiés). Optionnel — seules les
   * plateformes exposant une notion de captions (Udemy, YouTube) l'implémentent
   * réellement ; l'implémentation par défaut de BaseDeploymentAdapter est un
   * no-op documenté (aucune erreur, aucun effet) pour les autres.
   */
  addCaptions?(
    ctx: DeployContext,
    lesson: ILesson,
    index: number,
    locale: string,
    srtContent: string,
  ): Promise<void>;
}
