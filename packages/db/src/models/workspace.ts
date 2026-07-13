// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';

// Espace de travail d'équipe (Prompt 138, plan Business) : regroupe des cours
// sous plusieurs membres avec des rôles distincts (owner/editor/reviewer) au
// lieu d'un unique userId propriétaire. Un Course peut optionnellement
// rattacher un Workspace (Course.workspaceId, additif) — les cours existants
// restent liés à leur seul userId, aucune migration requise.
//
// Facturation centralisée : le Workspace N'A PAS de plan propre — il hérite du
// plan de son owner (User.plan). Choix documenté pour rester simple (Phase 1) :
// un seul abonnement Stripe/CMI par équipe, porté par le compte de l'owner ;
// toute évolution vers un plan Workspace dédié serait un futur prompt distinct.

export const WORKSPACE_ROLES = ['owner', 'editor', 'reviewer'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface IWorkspaceMember {
  userId: Types.ObjectId;
  role: WorkspaceRole;
  addedAt: Date;
}

export interface IWorkspace {
  ownerId: Types.ObjectId;
  name: string;
  members: IWorkspaceMember[];
  createdAt: Date;
  updatedAt: Date;
}

export type WorkspaceDocument = HydratedDocument<IWorkspace>;

const workspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: [...WORKSPACE_ROLES], required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const workspaceSchema = new Schema<IWorkspace>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    members: { type: [workspaceMemberSchema], default: [] },
  },
  { timestamps: true },
);

// Listing des workspaces d'un owner.
workspaceSchema.index({ ownerId: 1, createdAt: -1 });
// Recherche « mes workspaces » (owner OU membre) — un index par userId de membre.
workspaceSchema.index({ 'members.userId': 1 });

export const Workspace: Model<IWorkspace> =
  (mongoose.models.Workspace as Model<IWorkspace> | undefined) ??
  model<IWorkspace>('Workspace', workspaceSchema);
