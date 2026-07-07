import { Schema, model, models, type HydratedDocument, type Model } from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { LOCALES, PLANS, type Locale, type PlanId } from '@sallycourse/shared';

// Identifiants de plan dérivés de la constante partagée (free|pro|business).
const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export interface IUser {
  email: string;
  passwordHash: string;
  name: string;
  plan: PlanId;
  quotaUsed: {
    coursesThisMonth: number;
    periodStart: Date;
  };
  locale: Locale;
  role: 'user' | 'admin';
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    plan: { type: String, enum: PLAN_IDS, default: 'free' },
    quotaUsed: {
      coursesThisMonth: { type: Number, default: 0, min: 0 },
      periodStart: { type: Date, default: Date.now },
    },
    locale: { type: String, enum: [...LOCALES], default: 'fr' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true },
);

// Pattern hot-reload safe (Next) : réutilise le modèle déjà compilé.
export const User: Model<IUser> =
  (models.User as Model<IUser> | undefined) ?? model<IUser>('User', userSchema);
