'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import { Plug, Trash2, CheckCircle2, PlugZap } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Badge,
  useToast,
} from '@/components/ui';
import { PLATFORMS, type PlatformMeta } from '@/lib/platforms';

/** Credential connu côté client — sans le moindre secret. */
export interface ConnectedCredential {
  id: string;
  platform: string;
  accountLabel: string;
  kind: string;
}

interface PlatformsManagerProps {
  initialCredentials: ConnectedCredential[];
}

/** Clé i18n de la nature du secret. */
const KIND_LABEL_KEY: Record<string, string> = {
  password: 'kindPassword',
  apikey: 'kindApiKey',
  oauth: 'kindOAuth',
};

/**
 * Gestionnaire des connexions plateformes : liste des plateformes supportées
 * avec statut connecté/non connecté, formulaire d'ajout par plateforme, test
 * et déconnexion. Aucun secret ne transite en retour du serveur.
 */
export function PlatformsManager({ initialCredentials }: PlatformsManagerProps) {
  const { toast } = useToast();
  const t = useTranslations('settings.platforms');
  const _tApiError = useTranslations('apiErrors');
  const [credentials, setCredentials] = React.useState(initialCredentials);
  const [openPlatform, setOpenPlatform] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  // Multi-comptes (P49) : plusieurs comptes possibles par plateforme.
  const byPlatform = React.useMemo(() => {
    const map = new Map<string, ConnectedCredential[]>();
    for (const c of credentials) {
      const list = map.get(c.platform) ?? [];
      list.push(c);
      map.set(c.platform, list);
    }
    return map;
  }, [credentials]);

  async function handleTest(cred: ConnectedCredential) {
    setBusy(`test:${cred.id}`);
    try {
      const res = await fetch(`/api/platforms/${cred.id}/test`, { method: 'POST' });
      const json = (await res.json()) as { ok: boolean; mock?: boolean; message?: string };
      toast({
        variant: json.ok ? 'success' : 'danger',
        title: json.ok ? t('testSuccessTitle') : t('testFailTitle'),
        description: json.mock ? t('mockSuffix', { message: json.message ?? '' }) : json.message,
      });
    } catch {
      toast({ variant: 'danger', title: t('error'), description: t('testError') });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(cred: ConnectedCredential) {
    setBusy(`del:${cred.id}`);
    try {
      const res = await fetch(`/api/platforms/${cred.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setCredentials((prev) => prev.filter((c) => c.id !== cred.id));
      toast({ variant: 'success', title: t('disconnected'), description: cred.accountLabel });
    } catch {
      toast({ variant: 'danger', title: t('error'), description: t('disconnectError') });
    } finally {
      setBusy(null);
    }
  }

  function handleAdded(meta: PlatformMeta, cred: ConnectedCredential) {
    // Ajoute le compte ; remplace un éventuel compte de même libellé (upsert serveur).
    setCredentials((prev) => [
      cred,
      ...prev.filter(
        (c) => !(c.platform === cred.platform && c.accountLabel === cred.accountLabel),
      ),
    ]);
    setOpenPlatform(null);
    toast({ variant: 'success', title: t('connected', { label: meta.label }), description: cred.accountLabel });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PLATFORMS.map((meta) => {
        const accounts = byPlatform.get(meta.id) ?? [];
        const isOpen = openPlatform === meta.id;
        return (
          <Card key={meta.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-lg">{meta.label}</CardTitle>
                {accounts.length > 0 ? (
                  <Badge variant="published">
                    {t('accountsBadge', { count: accounts.length })}
                  </Badge>
                ) : (
                  <Badge variant="draft">{t('notConnected')}</Badge>
                )}
              </div>
              <p className="text-sm text-muted">{meta.description}</p>
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                {KIND_LABEL_KEY[meta.kind] ? t(KIND_LABEL_KEY[meta.kind]) : meta.kind}
              </p>
            </CardHeader>

            <CardContent className="mt-auto flex flex-col gap-3">
              {/* Multi-comptes (P49) : un bloc par compte connecté. */}
              {accounts.map((account) => (
                <div key={account.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 rounded-sm bg-surface-subtle px-3 py-2 text-sm">
                    <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                    <span className="truncate text-foreground">{account.accountLabel}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy === `test:${account.id}`}
                      onClick={() => handleTest(account)}
                    >
                      <PlugZap aria-hidden="true" /> {t('test')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `del:${account.id}`}
                      onClick={() => handleDelete(account)}
                    >
                      <Trash2 aria-hidden="true" /> {t('disconnect')}
                    </Button>
                  </div>
                </div>
              ))}

              {/* Ajout d'un compte (toujours disponible : plusieurs comptes possibles). */}
              {isOpen ? (
                <AddForm meta={meta} onCancel={() => setOpenPlatform(null)} onAdded={handleAdded} />
              ) : (
                <Button variant="primary" size="sm" onClick={() => setOpenPlatform(meta.id)}>
                  <Plug aria-hidden="true" />{' '}
                  {accounts.length > 0 ? t('addAccount') : t('connect')}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formulaire d'ajout par plateforme                                    */
/* ------------------------------------------------------------------ */

interface AddFormProps {
  meta: PlatformMeta;
  onCancel: () => void;
  onAdded: (meta: PlatformMeta, cred: ConnectedCredential) => void;
}

function AddForm({ meta, onCancel, onAdded }: AddFormProps) {
  const { toast } = useToast();
  const t = useTranslations('settings.platforms');
  const _tApiError = useTranslations('apiErrors');
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [accountLabel, setAccountLabel] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: meta.id,
          accountLabel: accountLabel.trim() || meta.label,
          fields: values,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        toast({ variant: 'danger', title: t('addError'), description: errorMessage(json, _tApiError) });
        return;
      }
      onAdded(meta, {
        id: json.id,
        platform: meta.id,
        accountLabel: accountLabel.trim() || meta.label,
        kind: meta.kind,
      });
    } catch {
      toast({ variant: 'danger', title: t('error'), description: t('networkError') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        label={t('accountLabel')}
        value={accountLabel}
        onChange={(e) => setAccountLabel(e.target.value)}
        placeholder={meta.label}
      />
      {meta.fields.map((field) => (
        <Input
          key={field.name}
          label={field.label}
          type={field.secret ? 'password' : 'text'}
          autoComplete={field.secret ? 'new-password' : 'off'}
          placeholder={field.placeholder}
          value={values[field.name] ?? ''}
          onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
        />
      ))}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {t('save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
