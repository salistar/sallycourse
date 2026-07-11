'use server';

import { templateCategorySchema } from '@sallycourse/shared';
import { auth } from '@/lib/auth';
import { findNicheOpportunities, type NicheResearchResult } from '@/lib/niche-research';

/**
 * Action serveur — recherche de niche (P86). Ré-exécutée à chaque
 * changement de catégorie côté client. Authentification requise (comme
 * toute action de ce dossier) mais aucune écriture : lecture pure.
 */
export type NicheResearchActionResult =
  | { ok: true; result: NicheResearchResult }
  | { ok: false; error: string };

export async function findNicheOpportunitiesAction(
  categoryInput: string,
): Promise<NicheResearchActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Authentification requise.' };

  const parsed = templateCategorySchema.safeParse(categoryInput);
  if (!parsed.success) return { ok: false, error: 'Catégorie invalide.' };

  const result = await findNicheOpportunities(parsed.data);
  return { ok: true, result };
}
