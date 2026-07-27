'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Textarea, useToast } from '@/components/ui';

/**
 * Kit anti-piratage DMCA (Prompt 206) — panneau du tableau de bord de l'auteur.
 * Génère (POST /api/lms/courses/[id]/dmca) le texte de la notification de retrait
 * + la checklist des pièces à réunir. AUCUN envoi automatique : l'auteur relit,
 * complète et transmet lui-même. Le vrai DRM (HLS chiffré, Widevine) est hors
 * périmètre — voir le compte rendu.
 */

interface DmcaChecklistItem {
  id: string;
  label: string;
  detail: string;
  done: boolean;
}

interface DmcaKitResponse {
  document: string;
  checklist: DmcaChecklistItem[];
  missing: string[];
}

export interface DmcaKitPanelProps {
  courseId: string;
}

export function DmcaKitPanel({ courseId }: DmcaKitPanelProps) {
  const t = useTranslations('course.dmca');
  const { toast } = useToast();
  const [urls, setUrls] = React.useState('');
  const [recipient, setRecipient] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [kit, setKit] = React.useState<DmcaKitResponse | null>(null);

  async function generate() {
    const infringingUrls = urls
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    if (infringingUrls.length === 0) {
      toast({ title: t('errorNeedUrl'), variant: 'danger' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/lms/courses/${courseId}/dmca`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ infringingUrls, recipient: recipient.trim() || undefined }),
      });
      if (!res.ok) {
        toast({ title: t('errorGenerateFailed'), variant: 'danger' });
        return;
      }
      setKit((await res.json()) as DmcaKitResponse);
    } catch {
      toast({ title: t('errorNetwork'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function copyDocument() {
    if (!kit) return;
    try {
      await navigator.clipboard.writeText(kit.document);
      toast({ title: t('copySuccess') });
    } catch {
      toast({ title: t('copyFailed'), variant: 'danger' });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('cardTitle')}</CardTitle>
        <CardDescription>{t('cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Textarea
          id="dmca-urls"
          label={t('urlsLabel')}
          rows={3}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder={'https://site-pirate.example/mon-cours\nhttps://autre.example/mirror'}
        />
        <Input
          id="dmca-recipient"
          label={t('recipientLabel')}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder={t('recipientPlaceholder')}
        />
        <div>
          <Button onClick={generate} disabled={busy}>
            {busy ? t('generating') : t('generateButton')}
          </Button>
        </div>

        {kit && (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-foreground">{t('takedownNoticeHeading')}</h4>
                <Button size="sm" variant="secondary" onClick={copyDocument}>
                  {t('copyButton')}
                </Button>
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-xs text-foreground">
                {kit.document}
              </pre>
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-foreground">{t('checklistHeading')}</h4>
              <ul className="flex flex-col gap-1.5">
                {kit.checklist.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <span aria-hidden="true">{item.done ? '✅' : '⬜'}</span>
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{item.label}</span>
                      <span className="text-muted"> — {item.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {kit.missing.length > 0 && (
                <p className="text-xs text-muted">{t('missingToComplete', { items: kit.missing.join(', ') })}</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
