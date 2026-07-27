'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { LLM_PROVIDER_CATALOG } from '@sallycourse/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Éditer avec l'IA » (2026-07-26) — régénère UNE partie du cours (vidéo,
 * article, TP ou quiz) à partir d'un prompt libre écrit par l'auteur, avec
 * choix du modèle LLM. POST /api/lessons/[id]/regenerate { instruction,
 * llmProviderId } → job 'regenerate-lesson'. Le contenu régénéré repasse
 * ensuite par le pipeline média habituel (rendu vidéo / captures TP).
 */
export interface EditWithAiButtonProps {
  lessonId: string;
  lessonTitle: string;
  /** Leçon déjà en cours de génération : action neutralisée. */
  disabled?: boolean;
}

export function EditWithAiButton({ lessonId, lessonTitle, disabled = false }: EditWithAiButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('course.editWithAi');
  const tApiError = useTranslations('apiErrors');
  const [open, setOpen] = React.useState(false);
  const [instruction, setInstruction] = React.useState('');
  const [provider, setProvider] = React.useState('auto');
  const [loading, setLoading] = React.useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = instruction.trim();
    if (!prompt) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: prompt,
          // 'auto' = laisse le cours décider (pas d'override envoyé).
          ...(provider && provider !== 'auto' ? { llmProviderId: provider } : {}),
        }),
      });
      if (res.ok) {
        setOpen(false);
        setInstruction('');
        toast({ title: t('startedTitle'), description: t('startedDescription', { title: lessonTitle }), variant: 'success' });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t('failedTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
      }
    } catch {
      toast({ title: t('failedTitle'), description: t('networkError'), variant: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? t('alreadyGenerating') : undefined}
      >
        <Sparkles aria-hidden="true" className="size-4" />
        {t('button')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles aria-hidden="true" className="size-4 text-accent" />
                {t('title')}
              </DialogTitle>
              <DialogDescription>{t('description', { title: lessonTitle })}</DialogDescription>
            </DialogHeader>

            <Textarea
              label={t('promptLabel')}
              placeholder={t('promptPlaceholder')}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              maxLength={1000}
              required
              autoFocus
            />

            <Select
              label={t('modelLabel')}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {LLM_PROVIDER_CATALOG.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                {t('cancel')}
              </Button>
              <Button type="submit" loading={loading} disabled={!instruction.trim()}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
