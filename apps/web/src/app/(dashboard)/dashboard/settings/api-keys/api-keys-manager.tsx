'use client';

import * as React from 'react';
import { KeyRound, Webhook as WebhookIcon, Trash2, Copy, Plus } from 'lucide-react';
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

/**
 * Gestionnaire client des clés API et webhooks. La clé en clair et le secret de
 * webhook ne sont connus qu'à la création : on les affiche alors dans un encart
 * copiable, jamais re-consultable ensuite.
 */

export interface ApiKeyView {
  id: string;
  prefix: string;
  label: string;
  lastUsed: string | null;
}

export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

/** Événements webhook proposés (miroir de WEBHOOK_EVENTS côté serveur). */
const WEBHOOK_EVENTS = [
  'outline_ready',
  'generation_complete',
  'deployed',
  'review_approved',
] as const;

const EVENT_LABEL: Record<string, string> = {
  outline_ready: 'Plan prêt',
  generation_complete: 'Génération terminée',
  deployed: 'Déployé',
  review_approved: 'Review approuvée',
};

interface Props {
  initialKeys: ApiKeyView[];
  initialWebhooks: WebhookView[];
}

export function ApiKeysManager({ initialKeys, initialWebhooks }: Props) {
  return (
    <div className="flex flex-col gap-10">
      <ApiKeysSection initialKeys={initialKeys} />
      <WebhooksSection initialWebhooks={initialWebhooks} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Encart « secret révélé une seule fois »                              */
/* ------------------------------------------------------------------ */

function RevealedSecret({ value, onDismiss }: { value: string; onDismiss: () => void }) {
  const { toast } = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast({ variant: 'success', title: 'Copié' });
    } catch {
      toast({ variant: 'danger', title: 'Copie impossible' });
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-warning/40 bg-warning/5 p-3">
      <p className="text-sm font-medium text-foreground">
        Copiez cette valeur maintenant — elle ne sera plus affichée.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-sm bg-surface-subtle px-2 py-1 text-2xs">
          {value}
        </code>
        <Button variant="secondary" size="sm" onClick={copy}>
          <Copy aria-hidden="true" /> Copier
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        J&apos;ai copié
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section clés API                                                     */
/* ------------------------------------------------------------------ */

function ApiKeysSection({ initialKeys }: { initialKeys: ApiKeyView[] }) {
  const { toast } = useToast();
  const [keys, setKeys] = React.useState(initialKeys);
  const [label, setLabel] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const json = (await res.json()) as {
        id?: string;
        prefix?: string;
        label?: string;
        key?: string;
        error?: string;
      };
      if (!res.ok || !json.id || !json.key) {
        toast({ variant: 'danger', title: 'Création impossible', description: json.error });
        return;
      }
      setKeys((prev) => [
        { id: json.id!, prefix: json.prefix!, label: json.label!, lastUsed: null },
        ...prev,
      ]);
      setRevealed(json.key);
      setLabel('');
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Réseau indisponible.' });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setKeys((prev) => prev.filter((k) => k.id !== id));
      toast({ variant: 'success', title: 'Clé révoquée' });
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Révocation impossible.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-muted" aria-hidden="true" />
          <CardTitle className="text-lg">Clés API</CardTitle>
        </div>
        <p className="text-sm text-muted">
          Authentifiez vos appels à l&apos;API publique v1 (en-tête{' '}
          <code className="text-2xs">Authorization: Bearer &lt;clé&gt;</code>).
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {revealed && (
          <RevealedSecret value={revealed} onDismiss={() => setRevealed(null)} />
        )}

        <form onSubmit={createKey} className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <Input
              label="Libellé de la clé"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="CI GitHub"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" loading={creating}>
            <Plus aria-hidden="true" /> Créer une clé
          </Button>
        </form>

        {keys.length === 0 ? (
          <p className="text-sm text-muted">Aucune clé. Créez-en une pour démarrer.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-3 rounded-sm bg-surface-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{k.label}</p>
                  <p className="text-2xs text-muted">
                    <code>{k.prefix}…</code>
                    {k.lastUsed
                      ? ` · utilisée le ${new Date(k.lastUsed).toLocaleDateString('fr-FR')}`
                      : ' · jamais utilisée'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy === k.id}
                  onClick={() => revoke(k.id)}
                >
                  <Trash2 aria-hidden="true" /> Révoquer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Section webhooks                                                     */
/* ------------------------------------------------------------------ */

function WebhooksSection({ initialWebhooks }: { initialWebhooks: WebhookView[] }) {
  const { toast } = useToast();
  const [hooks, setHooks] = React.useState(initialWebhooks);
  const [url, setUrl] = React.useState('');
  const [events, setEvents] = React.useState<string[]>([...WEBHOOK_EVENTS]);
  const [creating, setCreating] = React.useState(false);
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  function toggleEvent(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  async function createHook(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || events.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events }),
      });
      const json = (await res.json()) as {
        id?: string;
        url?: string;
        events?: string[];
        active?: boolean;
        secret?: string;
        error?: string;
      };
      if (!res.ok || !json.id || !json.secret) {
        toast({ variant: 'danger', title: 'Création impossible', description: json.error });
        return;
      }
      setHooks((prev) => [
        { id: json.id!, url: json.url!, events: json.events!, active: json.active ?? true },
        ...prev,
      ]);
      setRevealed(json.secret);
      setUrl('');
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Réseau indisponible.' });
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(hook: WebhookView) {
    setBusy(hook.id);
    try {
      const res = await fetch(`/api/webhooks/${hook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !hook.active }),
      });
      if (!res.ok) throw new Error();
      setHooks((prev) =>
        prev.map((h) => (h.id === hook.id ? { ...h, active: !h.active } : h)),
      );
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Mise à jour impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setHooks((prev) => prev.filter((h) => h.id !== id));
      toast({ variant: 'success', title: 'Webhook supprimé' });
    } catch {
      toast({ variant: 'danger', title: 'Erreur', description: 'Suppression impossible.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <WebhookIcon className="size-5 text-muted" aria-hidden="true" />
          <CardTitle className="text-lg">Webhooks</CardTitle>
        </div>
        <p className="text-sm text-muted">
          Recevez une requête POST signée (HMAC-SHA256, en-tête{' '}
          <code className="text-2xs">X-SallyCourse-Signature</code>) à chaque événement de vos cours.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {revealed && (
          <RevealedSecret value={revealed} onDismiss={() => setRevealed(null)} />
        )}

        <form onSubmit={createHook} className="flex flex-col gap-3">
          <Input
            label="URL de destination"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://exemple.com/webhooks/sallycourse"
          />
          <div className="flex flex-wrap gap-2">
            {WEBHOOK_EVENTS.map((ev) => {
              const on = events.includes(ev);
              return (
                <button
                  key={ev}
                  type="button"
                  onClick={() => toggleEvent(ev)}
                  className={
                    on
                      ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-2xs font-medium text-primary'
                      : 'rounded-full border border-border px-3 py-1 text-2xs text-muted'
                  }
                >
                  {EVENT_LABEL[ev]}
                </button>
              );
            })}
          </div>
          <div>
            <Button type="submit" variant="primary" size="sm" loading={creating}>
              <Plus aria-hidden="true" /> Ajouter un webhook
            </Button>
          </div>
        </form>

        {hooks.length === 0 ? (
          <p className="text-sm text-muted">Aucun webhook configuré.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {hooks.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-sm bg-surface-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{h.url}</p>
                  <p className="text-2xs text-muted">
                    {h.events.map((e) => EVENT_LABEL[e] ?? e).join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={h.active ? 'published' : 'draft'}>
                    {h.active ? 'Actif' : 'Inactif'}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === h.id}
                    onClick={() => toggleActive(h)}
                  >
                    {h.active ? 'Désactiver' : 'Activer'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === h.id}
                    onClick={() => remove(h.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
