'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * Formulaire de démo automatique (Prompt 96) — landing page. Saisie d'un
 * titre → POST /api/demo/generate (rate-limité, toujours mock) → redirection
 * vers /demo/[id]. Aucune authentification requise.
 */
export function DemoGeneratorForm() {
  const router = useRouter();
  const t = useTranslations('marketing.demoForm');
  const tApiError = useTranslations('apiErrors');
  const [title, setTitle] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim().length < 4) {
      setError(t('errors.minLength'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/demo/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(errorMessage(data, tApiError));
        setLoading(false);
        return;
      }
      router.push(`/demo/${data.id}`);
    } catch {
      setError(t('errors.network'));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex w-full max-w-lg flex-col items-center gap-3 sm:flex-row">
      <Input
        label={t('titleLabel')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('titlePlaceholder')}
        maxLength={200}
        disabled={loading}
        error={error ?? undefined}
        wrapperClassName="w-full"
      />
      <Button type="submit" variant="gold" loading={loading} className="w-full gap-2 self-start sm:w-auto">
        <Sparkles className="size-4" aria-hidden="true" />
        {t('submit')}
      </Button>
    </form>
  );
}
