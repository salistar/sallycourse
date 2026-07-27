import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connectDb, ApiKey, Webhook } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { ApiKeysManager, type ApiKeyView, type WebhookView } from './api-keys-manager';

/**
 * Réglages → API : gestion des clés API (accès à l'API publique v1) et des
 * webhooks sortants. Cette page ne lit QUE les métadonnées publiques : jamais
 * la clé en clair ni le secret de webhook (renvoyés une seule fois à la création).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.apiKeysPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function ApiKeysSettingsPage() {
  const t = await getTranslations('settings.apiKeysPage');
  const user = await requireUser();

  await connectDb();

  const [keys, hooks] = await Promise.all([
    ApiKey.find({ userId: user.id })
      .select('prefix label lastUsed createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    Webhook.find({ userId: user.id })
      .select('url events active createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const initialKeys: ApiKeyView[] = keys.map((k) => ({
    id: String(k._id),
    prefix: k.prefix,
    label: k.label,
    lastUsed: k.lastUsed ? new Date(k.lastUsed).toISOString() : null,
  }));

  const initialWebhooks: WebhookView[] = hooks.map((h) => ({
    id: String(h._id),
    url: h.url,
    events: h.events,
    active: h.active,
  }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="max-w-2xl text-muted">{t('intro')}</p>
      </header>

      <ApiKeysManager initialKeys={initialKeys} initialWebhooks={initialWebhooks} />
    </div>
  );
}
