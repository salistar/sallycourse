// Défaut + destructuration : l'export nommé `models` de mongoose (CJS) n'est
// pas détecté par le lexer de Node ESM (worker exécuté via tsx).
import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
// prettier-ignore
// @ts-ignore TS6059/TS2305 — consommé en source par le worker (NodeNext) ; typage intact ici (Bundler)
import { BLOG_POST_STATUSES, SEARCH_INTENTS, type BlogPostStatus, type SearchIntent } from '@sallycourse/shared';

// Article de blog SEO (Prompt 204) — généré à la PUBLICATION d'un cours sur le
// LMS interne, puis publié selon un calendrier étalé (1 par semaine par défaut).
// Le Markdown persisté est le contenu COMPLET (corps rédigé + maillage interne
// + CTA vers /learn/{courseId}) : la page publique /blog/[slug] le rend tel quel.

/** Une question/réponse de la FAQ de l'article (alimente le JSON-LD FAQPage). */
export interface IBlogFaqEntry {
  question: string;
  answer: string;
}

export interface IBlogPost {
  /** Cours dont l'article fait la promotion (CTA + JSON-LD). */
  courseId: Types.ObjectId;
  /** Auteur du cours — ownership des actions dashboard (régénération). */
  userId: Types.ObjectId;
  /** Identifiant d'URL public (/blog/{slug}) — unique sur toute la collection. */
  slug: string;
  title: string;
  /** Mot-clé (ou expression) cible de l'article. */
  keyword: string;
  searchIntent: SearchIntent;
  /** Balise <meta name="description"> de la page publique. */
  metaDescription: string;
  /** Corps COMPLET en Markdown (maillage + CTA déjà appendus). */
  markdown: string;
  faq: IBlogFaqEntry[];
  status: BlogPostStatus;
  /** Rang dans le plan éditorial du cours (0-based) — ordre de publication. */
  order: number;
  /** Échéance de publication (le cron ne publie que scheduledFor <= now). */
  scheduledFor: Date;
  /** Renseignée au passage effectif en 'published'. */
  publishedAt?: Date;
  /** Slugs des autres articles du même cours cités dans « À lire aussi ». */
  internalLinks: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type BlogPostDocument = HydratedDocument<IBlogPost>;

const blogFaqEntrySchema = new Schema<IBlogFaqEntry>(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const blogPostSchema = new Schema<IBlogPost>(
  {
    // Pas d'`index: true` sur courseId/status : ils sont déjà en PRÉFIXE des index
    // composés ci-dessous (un index simple ferait doublon — Mongoose le signale).
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    title: { type: String, required: true, trim: true },
    keyword: { type: String, required: true, trim: true },
    searchIntent: { type: String, enum: [...SEARCH_INTENTS], default: 'informational' },
    metaDescription: { type: String, default: '' },
    markdown: { type: String, required: true },
    faq: { type: [blogFaqEntrySchema], default: [] },
    status: { type: String, enum: [...BLOG_POST_STATUSES], default: 'scheduled' },
    order: { type: Number, default: 0, min: 0 },
    scheduledFor: { type: Date, required: true },
    publishedAt: { type: Date },
    internalLinks: { type: [String], default: [] },
  },
  { timestamps: true },
);

// Index du cron de publication : articles programmés arrivés à échéance.
blogPostSchema.index({ status: 1, scheduledFor: 1 });
// Index de l'index public /blog : articles publiés, du plus récent au plus ancien.
blogPostSchema.index({ status: 1, publishedAt: -1 });
// Index du panneau dashboard : les articles d'un cours, dans l'ordre du plan.
blogPostSchema.index({ courseId: 1, order: 1 });

export const BlogPost: Model<IBlogPost> =
  (mongoose.models.BlogPost as Model<IBlogPost> | undefined) ?? model<IBlogPost>('BlogPost', blogPostSchema);
