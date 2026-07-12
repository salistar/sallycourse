import { connectDb, SchoolBranding } from '@sallycourse/db';
import type { WhiteLabelSite } from './white-label';

/**
 * Résolution I/O (Mongo) du branding white-label (Prompt 143). Séparé de
 * white-label.ts (pur) car ce module importe Mongoose — jamais depuis
 * middleware.ts (Edge Runtime), uniquement depuis des Server
 * Components/Route Handlers Node classiques (ex. app/school/[subdomain]/*).
 */
export async function resolveWhiteLabelSite(subdomain: string): Promise<WhiteLabelSite | null> {
  await connectDb();
  const doc = await SchoolBranding.findOne({ customSubdomain: subdomain }).lean();
  if (!doc) return null;
  return {
    ownerId: String(doc.userId),
    schoolName: doc.schoolName,
    logoKey: doc.logoUrl,
    primaryColorHex: doc.primaryColorHex,
    accentColorHex: doc.accentColorHex,
  };
}
