'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Send, Check, X, Loader2 } from 'lucide-react';
import type { AssistantAction } from '@sallycourse/shared/voice-intent';
import { Button, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * Assistant conversationnel du dashboard (Prompt 210). L'utilisateur exprime une
 * intention en langage naturel ; POST /api/assistant/command la RÉSOUT et
 * renvoie une action PROPOSÉE (jamais exécutée). L'action à effet de bord
 * (création, régénération, déploiement) n'est lancée qu'après une CONFIRMATION
 * explicite ici, en appelant la route métier existante décrite par `execution`.
 */

interface AssistantExecution {
  method: 'POST';
  path: string;
  body?: Record<string, unknown>;
}

interface CommandResponse {
  action: AssistantAction;
  execution: AssistantExecution | null;
  summary: string;
  requiresConfirmation: boolean;
}

export function AssistantPanel({
  currentCourseId,
  currentCourseTitle,
}: {
  currentCourseId?: string;
  currentCourseTitle?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const tApiError = useTranslations('apiErrors');
  const t = useTranslations('dashboard.assistant');
  const [command, setCommand] = React.useState('');
  const [resolving, setResolving] = React.useState(false);
  const [executing, setExecuting] = React.useState(false);
  const [plan, setPlan] = React.useState<CommandResponse | null>(null);

  const resolve = async () => {
    const text = command.trim();
    if (!text || resolving) return;
    setResolving(true);
    setPlan(null);
    try {
      const res = await fetch('/api/assistant/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command: text, ...(currentCourseId ? { currentCourseId } : {}) }),
      });
      const data = (await res.json().catch(() => null)) as (CommandResponse & { error?: string }) | null;
      if (!res.ok || !data) {
        toast({ title: t('toast.unavailable'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      setPlan(data);
    } catch {
      toast({ title: t('toast.connectionFailed'), description: t('toast.checkNetwork'), variant: 'danger' });
    } finally {
      setResolving(false);
    }
  };

  /** Exécute l'action APRÈS confirmation, via la route métier existante. */
  const confirmAndRun = async () => {
    if (!plan?.execution || executing) return;
    setExecuting(true);
    try {
      const { method, path, body } = plan.execution;
      const res = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok) {
        toast({ title: t('toast.actionRejected'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }
      toast({ title: t('toast.actionStarted'), description: plan.summary, variant: 'success' });
      setPlan(null);
      setCommand('');
      // Création de cours : la route renvoie l'id → on ouvre le cours.
      if (plan.action.type === 'create_course' && data?.id) {
        router.push(`/dashboard/courses/${data.id}`);
      } else {
        router.refresh();
      }
    } catch {
      toast({ title: t('toast.connectionFailed'), description: t('toast.checkNetwork'), variant: 'danger' });
    } finally {
      setExecuting(false);
    }
  };

  const canConfirm = Boolean(plan?.requiresConfirmation && plan.execution);

  return (
    <section
      aria-label={t('regionLabel')}
      className="flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> {t('title')}
        {currentCourseTitle && <span className="truncate text-xs font-normal text-muted">· {currentCourseTitle}</span>}
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void resolve();
        }}
      >
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('commandAriaLabel')}
          className="min-w-0 flex-1 rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted"
        />
        <Button type="submit" size="sm" loading={resolving} aria-label={t('sendAriaLabel')}>
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>

      {plan && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3" aria-live="polite">
          <p className="text-sm text-foreground">{plan.summary}</p>

          {canConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-2xs uppercase tracking-widest text-muted">{t('confirmQuestion')}</span>
              <Button size="sm" variant="primary" loading={executing} onClick={() => void confirmAndRun()}>
                {executing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t('confirm')}
              </Button>
              <Button size="sm" variant="ghost" disabled={executing} onClick={() => setPlan(null)}>
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t('cancel')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">{t('noAction')}</p>
          )}
        </div>
      )}

      <p className="text-2xs text-muted">
        {t('disclaimer')}
      </p>
    </section>
  );
}
