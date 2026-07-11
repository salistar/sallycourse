import type { Metadata } from 'next';
import { AdminNav } from '@/components/admin';
import { requireAdmin } from '../guard';
import { PromptPlayground } from './prompt-playground';

/**
 * Page admin — playground de prompts (P93) : édition/versioning des prompts
 * système/utilisateur de chaque générateur, avec test A/B côte à côte contre
 * la version précédemment active. Migration non destructive : tant qu'aucune
 * version n'est enregistrée pour une clé, le pipeline continue d'utiliser le
 * prompt en dur du générateur (apps/worker/src/lib/prompt-registry.ts,
 * getActivePrompt()).
 */

export const metadata: Metadata = {
  title: 'Admin — Prompts — SallyCourse',
};

export const dynamic = 'force-dynamic';

export default async function AdminPromptsPage() {
  await requireAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Prompts</h1>
        <p className="mt-1 text-sm text-muted">
          Éditez et versionnez les prompts de génération sans redéployer. Une version active en base
          surcharge le prompt en dur du générateur ; le bouton « Tester » compare la version en cours
          d&apos;édition à la version précédemment active.
        </p>
      </div>

      <AdminNav />

      <PromptPlayground />
    </div>
  );
}
