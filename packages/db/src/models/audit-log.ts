import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Journal d'audit transversal (Prompt 149) : trace les actions sensibles de la
// plateforme (connexion, inscription, changement de credentials plateforme,
// déploiement, suppression de cours, accès admin) pour transparence
// utilisateur (page "Mon activité") ET supervision admin (page "Audit
// global"). Complète TeamActivity (Prompt 138, scope Workspace uniquement) —
// AuditLog couvre lui tout le cycle de vie compte/plateforme, pas seulement
// l'activité d'équipe.
//
// IMMUABLE PAR CONCEPTION : aucune méthode update/delete n'est exposée sur ce
// modèle (pas de .updateOne/.findOneAndUpdate/.deleteMany utilitaire ajouté
// ici). Seule la création (recordAudit, voir packages/shared/src/audit.ts) et
// la lecture sont des opérations supportées. La purge par rétention (cron,
// apps/worker/src/lib/audit-retention.ts) est le SEUL point qui supprime des
// entrées, et seulement celles dépassant la fenêtre de rétention légale.

/** Actions auditées — liste large, complétée au fil des points sensibles câblés. */
export const AUDIT_ACTIONS = [
  'login',
  'login.failed',
  'register',
  'logout',
  'credentials.changed',
  'credentials.deleted',
  'deployment.created',
  'course.deleted',
  'admin.access',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Type de la cible affectée par l'action (facultatif selon l'action). */
export const AUDIT_TARGET_TYPES = [
  'user',
  'course',
  'platform_credential',
  'deployment',
  'admin_page',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface IAuditLog {
  /** Utilisateur à l'origine de l'action (absent si tentative pré-authentification, ex. login.failed sur email inconnu). */
  userId?: Types.ObjectId;
  action: AuditAction;
  targetType?: AuditTargetType;
  /** Identifiant de la cible — string libre (peut référencer un id Mongo ou un chemin d'URL admin). */
  targetId?: string;
  /** IP source, extraite côté serveur (voir lib/rate-limit extractClientIp). */
  ip?: string;
  userAgent?: string;
  /** Détail libre (ex : plateforme concernée, ancien/nouveau rôle) — jamais de secret en clair. */
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type AuditLogDocument = HydratedDocument<IAuditLog>;

const auditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, enum: [...AUDIT_ACTIONS], required: true },
    targetType: { type: String, enum: [...AUDIT_TARGET_TYPES] },
    targetId: { type: String, trim: true },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    // Pas de updatedAt : un journal d'audit ne se modifie jamais après coup.
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Page utilisateur "Mon activité" : historique perso du plus récent au plus ancien.
auditLogSchema.index({ userId: 1, createdAt: -1 });
// Page admin "Audit global" : filtrage par action et par date.
auditLogSchema.index({ action: 1, createdAt: -1 });
// Purge par rétention (cron) : balayage par ancienneté.
auditLogSchema.index({ createdAt: 1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const AuditLog: Model<IAuditLog> =
  (models.AuditLog as Model<IAuditLog> | undefined) ??
  model<IAuditLog>('AuditLog', auditLogSchema);
