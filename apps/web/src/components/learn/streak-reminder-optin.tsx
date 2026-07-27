'use client';

import * as React from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { useTranslations } from 'next-intl';

/**
 * Opt-in aux rappels de série (Prompt 200) : enregistre le service worker
 * (/sw.js), demande la permission de notification puis souscrit au Web Push
 * avec la clé publique VAPID exposée par GET /api/notifications/push-subscribe
 * (route existante, P156). L'abonnement est POSTé à cette même route ; le cron
 * du worker (streak-reminder.ts) s'en sert pour rappeler à l'apprenant de
 * maintenir sa série.
 *
 * Dégradé propre : navigateur sans Service Worker / Push, ou VAPID non
 * configuré côté serveur → le bloc n'affiche rien (les rappels restent
 * disponibles dans la cloche in-app, qui ne dépend pas du push).
 */

/**
 * Décode la clé publique VAPID base64url en ArrayBuffer — `applicationServerKey`
 * attend un BufferSource, l'API navigateur n'accepte pas la chaîne base64url.
 */
function vapidKeyToBuffer(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

type Status = 'loading' | 'unavailable' | 'off' | 'on';

export function StreakReminderOptIn() {
  const { toast } = useToast();
  const t = useTranslations('learn.streak');
  const [status, setStatus] = React.useState<Status>('loading');
  const [busy, setBusy] = React.useState(false);
  const [publicKey, setPublicKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supported =
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window;
      if (!supported) {
        if (!cancelled) setStatus('unavailable');
        return;
      }

      try {
        const res = await fetch('/api/notifications/push-subscribe', { cache: 'no-store' });
        if (!res.ok) throw new Error('vapid');
        const data = (await res.json()) as { publicKey: string | null; enabled: boolean };
        if (cancelled) return;
        if (!data.enabled || !data.publicKey) {
          setStatus('unavailable');
          return;
        }
        setPublicKey(data.publicKey);

        // Déjà abonné sur ce navigateur ?
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        const existing = await registration?.pushManager.getSubscription();
        if (cancelled) return;
        setStatus(existing ? 'on' : 'off');
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast({
          title: t('permissionDeniedTitle'),
          description: t('permissionDeniedDescription'),
          variant: 'danger',
        });
        setStatus('off');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBuffer(publicKey),
      });

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const res = await fetch('/api/notifications/push-subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        }),
      });
      if (!res.ok) throw new Error('subscribe');

      setStatus('on');
      toast({
        title: t('enabledTitle'),
        description: t('enabledDescription'),
        variant: 'success',
      });
    } catch {
      setStatus('off');
      toast({ title: t('enableErrorTitle'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/notifications/push-subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setStatus('off');
      toast({ title: t('disabledTitle'), variant: 'success' });
    } catch {
      setStatus('on');
      toast({ title: t('disableErrorTitle'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading' || status === 'unavailable') return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <p className="flex items-center gap-2 text-2xs text-muted">
        {status === 'on' ? (
          <BellRing className="size-3.5 text-accent-400" aria-hidden="true" />
        ) : (
          <Bell className="size-3.5" aria-hidden="true" />
        )}
        {status === 'on'
          ? t('statusOn')
          : t('statusOff')}
      </p>
      {status === 'on' ? (
        <Button variant="secondary" size="sm" onClick={disable} disabled={busy}>
          <BellOff aria-hidden="true" />
          {busy ? t('disabling') : t('disable')}
        </Button>
      ) : (
        <Button size="sm" onClick={enable} disabled={busy}>
          <Bell aria-hidden="true" />
          {busy ? t('enabling') : t('enable')}
        </Button>
      )}
    </div>
  );
}
