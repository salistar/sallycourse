// Détection de delta pour la MISE À JOUR ciblée d'un déploiement (Prompt 46).
//
// La logique PURE vit dans @sallycourse/shared/lesson-delta (source de vérité
// partagée worker ⇄ web : « ce que le web propose de mettre à jour » ==
// « ce que le worker re-uploade »). Ce module la ré-exporte pour le worker (les
// adapters/processor importent './updates.js') et n'ajoute aucun comportement.
//
// Le contrat DeployCheckpoint du worker (types.ts) est structurellement
// compatible avec LessonDeltaCheckpoint ; ILesson (db) l'est avec
// LessonContentInput (assets/clés S3).

export {
  lessonContentHash,
  indexSnapshot,
  detectLessonUpdates,
  hasPendingUpdates,
  nextSnapshot,
  pendingUpdateCursor,
  runResumableUpdates,
  type LessonContentInput,
  type DeployedLessonSnapshot,
  type LessonDeltaCheckpoint,
  type LessonChangeKind,
  type LessonUpdate,
  type UpdatePlan,
} from '../shared.js';
