'use client';

import * as React from 'react';
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

/** Libellé français de la nature du secret. */
const KIND_LABEL: Record<string, string> = {
  password: 'Mot de passe',
  apikey: 'Clé API',
  oauth: 'OAuth',
};

/**
 * Gestionnaire des connexions plateformes : liste des plateformes supportées
 * avec statut connecté/non connecté, formulaire d'ajout par plateforme, test
 * et déconnexion. Aucun secret ne transite en retour du serveur.
 */
export function PlatformsManager({ initialCredentials }: PlatformsManagerProps) {
  const { toast } = useToast();
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
        title: json.ok ? 'Connexion OK' : 'Connexion échouée',
        description: json.mock ? `${json.message ?? ''} (mode mock)` : json.message,
      });
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Test impossible.' });
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
      toast({ variant: 'success', title: 'Déconnecté', description: cred.accountLabel });
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Déconnexion impossible.' });
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
    toast({ variant: 'success', title: `${meta.label} connecté`, description: cred.accountLabel });
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
                    {accounts.length > 1 ? `${accounts.length} comptes` : 'Connecté'}
                  </Badge>
                ) : (
                  <Badge variant="draft">Non connecté</Badge>
                )}
              </div>
              <p className="text-sm text-muted">{meta.description}</p>
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                {KIND_LABEL[meta.kind] ?? meta.kind}
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
                      <PlugZap aria-hidden="true" /> Tester
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === `del:${account.id}`}
                      onClick={() => handleDelete(account)}
                    >
                      <Trash2 aria-hidden="true" /> Déconnecter
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
                  {accounts.length > 0 ? 'Ajouter un compte' : 'Connecter'}
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
        toast({ variant: 'danger', title: 'Ajout impossible', description: json.error });
        return;
      }
      onAdded(meta, {
        id: json.id,
        platform: meta.id,
        accountLabel: accountLabel.trim() || meta.label,
        kind: meta.kind,
      });
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Réseau indisponible.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        label="Libellé du compte"
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
          Enregistrer
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
