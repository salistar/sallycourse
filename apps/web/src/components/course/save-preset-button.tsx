'use client';

import * as React from 'react';
import { Layers } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, useToast } from '@/components/ui';
import type { DeploymentMode } from '@sallycourse/db';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * Bouton « Enregistrer comme preset » (P109) — capture la sélection courante
 * de plateformes + mode d'un déploiement (ex. dans DeployPanel) et l'enregistre
 * comme DeployPreset réutilisable. Composant autonome, sans dépendance sur
 * l'état interne du panneau de déploiement (props uniquement) : peut être
 * inséré dans n'importe quel écran de configuration de déploiement.
 */
export interface SavePresetButtonProps {
  platforms: string[];
  mode: DeploymentMode;
  disabled?: boolean;
}

export function SavePresetButton({ platforms, mode, disabled = false }: SavePresetButtonProps) {
  const t = useTranslations('course.savePreset');
  const tApiError = useTranslations('apiErrors');
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || platforms.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/deploy-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          platforms: platforms.map((platform) => ({ platform, mode })),
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('toastSaveErrorTitle'), description: errorMessage(json, tApiError) });
        return;
      }
      toast({ variant: 'success', title: t('toastSavedTitle'), description: name.trim() });
      setOpen(false);
      setName('');
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkErrorTitle'), description: t('toastNetworkErrorBody') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <Layers aria-hidden="true" /> {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="mt-4 flex flex-col gap-4">
            <Input
              label={t('nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
            <p className="text-xs text-muted">
              {t('summary', { count: platforms.length, mode })}
            </p>
            <DialogFooter>
              <Button type="submit" variant="primary" loading={saving} disabled={!name.trim()}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
