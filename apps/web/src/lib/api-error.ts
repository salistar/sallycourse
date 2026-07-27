import { NextResponse } from 'next/server';

/**
 * Table des erreurs API normalisées (i18n V5, §6.3) : `code` → message FR
 * (fallback conservé, source de vérité serveur) + statut HTTP par défaut.
 *
 * Le client localise via `errorMessage(data, t)` (voir `./error-message`) :
 * `t('apiErrors.'+code)` si la clé existe, sinon le message FR brut. Les
 * messages FR ci-dessous DOIVENT rester identiques aux clés `apiErrors.*` des
 * catalogues de traduction (fr.json) — c'est le repli affiché aux clients API
 * non-navigateur et aux locales non couvertes.
 *
 * Couvre le top ~44 des messages (≈ 70 % des occurrences). Les routes non
 * migrées continuent de renvoyer leur `{ error: '…' }` d'origine sans `code`.
 */
export const API_ERRORS = {
  courseNotFound: { status: 404, fr: 'Cours introuvable.' },
  invalidJson: { status: 400, fr: 'Corps JSON invalide.' },
  lessonNotFound: { status: 404, fr: 'Leçon introuvable.' },
  invalidData: { status: 400, fr: 'Données invalides.' },
  userNotFound: { status: 404, fr: 'Utilisateur introuvable.' },
  invalidMultipart: { status: 400, fr: 'Requête multipart invalide.' },
  pathNotFound: { status: 404, fr: 'Parcours introuvable.' },
  presetNotFound: { status: 404, fr: 'Preset introuvable.' },
  enrollmentRequired: { status: 403, fr: 'Inscription requise.' },
  notFound: { status: 404, fr: 'Introuvable.' },
  invalidId: { status: 400, fr: 'Identifiant invalide.' },
  clientNotFound: { status: 404, fr: 'Client introuvable.' },
  unknownPlatform: { status: 400, fr: 'Plateforme inconnue.' },
  deploymentNotFound: { status: 404, fr: 'Déploiement introuvable.' },
  webhookNotFound: { status: 404, fr: 'Webhook introuvable.' },
  adminOnly: { status: 403, fr: 'Accès réservé aux administrateurs.' },
  agencyOnly: { status: 403, fr: 'Réservé aux comptes agence.' },
  internalError: { status: 500, fr: 'Erreur interne, réessayez plus tard.' },
  invalidCourseId: { status: 400, fr: 'courseId invalide.' },
  courseNotReadyForDeploy: {
    status: 409,
    fr: 'Le cours doit être généré (prêt) avant tout déploiement.',
  },
  courseStillGenerating: {
    status: 409,
    fr: 'Le cours est encore en cours de génération — réessayez quand il sera prêt.',
  },
  invalidRequest: { status: 400, fr: 'Requête invalide.' },
  certificateWhiteLabelBusiness: {
    status: 403,
    fr: 'La marque blanche du certificat est réservée au plan Business.',
  },
  handleTaken: { status: 409, fr: 'Ce handle est déjà pris.' },
  platformAccountsNotFound: {
    status: 400,
    fr: 'Un ou plusieurs comptes plateforme référencés sont introuvables.',
  },
  keyNotFound: { status: 404, fr: 'Clé introuvable.' },
  tooManyRequests: { status: 429, fr: 'Trop de requêtes, réessayez plus tard.' },
  emailAlreadyExists: { status: 409, fr: 'Un compte existe déjà avec cet email.' },
  invoiceNotFound: { status: 404, fr: 'Facture introuvable.' },
  couponNotFound: { status: 404, fr: 'Coupon introuvable.' },
  cannotStartGeneration: {
    status: 500,
    fr: 'Impossible de démarrer la génération, réessayez plus tard.',
  },
  missingFile: { status: 400, fr: 'Fichier manquant (champ « file »).' },
  unsupportedVideoFormat: {
    status: 400,
    fr: 'Format non supporté (MP4, MOV ou WebM attendu).',
  },
  emptyRecording: { status: 400, fr: 'Enregistrement vide.' },
  recordingStorageFailed: { status: 500, fr: 'Échec du stockage de l’enregistrement.' },
  invalidManualPlatform: { status: 400, fr: 'Plateforme manuelle invalide.' },
  lessonNotArticle: { status: 400, fr: 'Cette leçon n’est pas un article.' },
  sectionNotFound: { status: 404, fr: 'Section introuvable.' },
  cannotRegenerate: {
    status: 500,
    fr: 'Impossible de lancer la régénération, réessayez plus tard.',
  },
  versionNotFound: { status: 404, fr: 'Version introuvable.' },
  versionCorrupted: { status: 500, fr: 'Version corrompue.' },
  duplicateCourseInPath: {
    status: 409,
    fr: 'Un même cours ne peut pas figurer deux fois dans un parcours.',
  },
  pathUnavailable: { status: 403, fr: 'Parcours non disponible.' },
  invalidPlan: { status: 400, fr: 'Plan invalide (pro | business attendu).' },
  invalidSignature: { status: 401, fr: 'Signature invalide.' },
  credentialNotFound: { status: 404, fr: 'Credential introuvable.' },
  unknownError: { status: 500, fr: 'Une erreur est survenue, réessayez plus tard.' },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

/**
 * Réponse d'erreur normalisée `{ error: <FR>, code }` avec le statut par défaut
 * du code (surchargable). À utiliser dans les nouveaux route handlers ; les
 * routes existantes ont été rétro-équipées d'un simple champ `code` par codemod.
 */
export function apiError(code: ApiErrorCode, init?: { status?: number }): NextResponse {
  const def = API_ERRORS[code];
  return NextResponse.json({ error: def.fr, code }, { status: init?.status ?? def.status });
}
