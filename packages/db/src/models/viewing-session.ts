// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Sessions de visionnage par appareil (Prompt 206, anti-partage de compte). Une
// ligne = un (étudiant × appareil) : rafraîchie (`lastSeenAt`) à chaque lecture
// de leçon. La détection des appareils simultanés est PURE
// (@sallycourse/shared/device-sessions : evaluateConcurrentSessions) et lit ces
// lignes ; on ne bloque jamais le compte (décision produit) — on alerte
// l'étudiant + l'auteur. `deviceId` est une empreinte OPAQUE hachée côté route
// (jamais l'IP/User-Agent en clair). `alertedAt` throttle les alertes répétées.

export interface IViewingSession {
  studentId: Types.ObjectId;
  courseId: Types.ObjectId;
  /** Empreinte d'appareil hachée (sha256 de deviceId client + User-Agent). */
  deviceId: string;
  /** Dernière lecture observée (rafraîchie à chaque play). */
  lastSeenAt: Date;
  /** Dernière alerte de partage émise pour CET appareil (anti-spam). */
  alertedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ViewingSessionDocument = HydratedDocument<IViewingSession>;

const viewingSessionSchema = new Schema<IViewingSession>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    deviceId: { type: String, required: true },
    lastSeenAt: { type: Date, required: true, default: () => new Date() },
    alertedAt: { type: Date },
  },
  { timestamps: true },
);

// Une seule ligne par (étudiant, appareil) : upsert idempotent à chaque play.
viewingSessionSchema.index({ studentId: 1, deviceId: 1 }, { unique: true });
// Purge automatique des sessions inactives (TTL 30 j — bien au-delà de la
// fenêtre d'activité de 15 min ; garde un historique court pour l'alerting).
viewingSessionSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const ViewingSession: Model<IViewingSession> =
  (mongoose.models.ViewingSession as Model<IViewingSession> | undefined) ??
  model<IViewingSession>('ViewingSession', viewingSessionSchema);
