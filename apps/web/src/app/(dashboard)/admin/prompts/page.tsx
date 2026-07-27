import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.promptsPage');
  return {
    title: t('metaTitle'),
  };
}

export const dynamic = 'force-dynamic';

export default async function AdminPromptsPage() {
  await requireAdmin();

  const t = await getTranslations('admin.promptsPage');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('description')}</p>
      </div>

      <AdminNav />

      <PromptPlayground />
    </div>
  );
}
