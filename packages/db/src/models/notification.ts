import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Notification in-app d'un utilisateur (Prompt 59). Émise aux transitions du
// cycle de vie (génération terminée, déploiement terminé, review approuvée /
// rejetée, quota atteint). Affichée dans la cloche du header dashboard ;
// éventuellement doublée d'un email (voir packages/db notification-service).

/** Types de notification — source de vérité partagée (in-app + email). */
export const NOTIFICATION_TYPES = [
  'generation_complete',
  'deployment_complete',
  'review_approved',
  'review_rejected',
  'quota_reached',
  /** Traçabilité conformité (P81) : audio généré avec une voix clonée. */
  'voice_clone_used',
  /**
   * Mise à jour automatique des cours (P91) : le cron trimestriel a détecté
   * qu'un cours a probablement des sujets obsolètes et propose des leçons à
   * mettre à jour (Course.refreshSuggestions). Jamais appliqué seul.
   */
  'course_refresh_available',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification {
  userId: Types.ObjectId;
  /** Nature de l'événement — pilote l'icône et le gabarit email. */
  type: NotificationType;
  /** Titre court affiché dans la liste (déjà localisé côté émetteur). */
  title: string;
  /** Corps descriptif (une phrase). */
  body: string;
  /** Lu par l'utilisateur : masque le badge de non-lus. */
  read: boolean;
  /** Lien interne facultatif ouvert au clic (ex: /dashboard/courses/<id>). */
  link?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: [...NOTIFICATION_TYPES], required: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false },
    link: { type: String, trim: true },
  },
  { timestamps: true },
);

// Liste récente par utilisateur + comptage des non-lus.
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const Notification: Model<INotification> =
  (models.Notification as Model<INotification> | undefined) ??
  model<INotification>('Notification', notificationSchema);
