import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Journal d'activité d'équipe basique (Prompt 138) : trace les actions clés
// d'un Workspace (approbation de déploiement, ajout de membre, commentaire).
// Volontairement minimal — si le futur audit log transversal (P149) voit le
// jour, ce modèle pourra être fusionné/étendu ; en attendant il couvre le
// besoin de visibilité d'équipe sans dépendance à un système non encore livré.

export const TEAM_ACTIVITY_ACTIONS = [
  'workspace_created',
  'member_added',
  'member_removed',
  'course_linked',
  'comment_added',
  'deploy_approved',
] as const;
export type TeamActivityAction = (typeof TEAM_ACTIVITY_ACTIONS)[number];

export interface ITeamActivity {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  action: TeamActivityAction;
  /** Détail court, déjà formaté (ex: nom du cours, du membre ajouté). */
  detail?: string;
  /** Référence facultative (courseId/lessonId) selon l'action. */
  targetId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type TeamActivityDocument = HydratedDocument<ITeamActivity>;

const teamActivitySchema = new Schema<ITeamActivity>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: [...TEAM_ACTIVITY_ACTIONS], required: true },
    detail: { type: String, trim: true },
    targetId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

// Fil d'activité d'un workspace, du plus récent au plus ancien.
teamActivitySchema.index({ workspaceId: 1, createdAt: -1 });

export const TeamActivity: Model<ITeamActivity> =
  (models.TeamActivity as Model<ITeamActivity> | undefined) ??
  model<ITeamActivity>('TeamActivity', teamActivitySchema);
