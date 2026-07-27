'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Copy, ExternalLink, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardContent, Input, useToast } from '@/components/ui';

/**
 * Réglages → Page publique (Prompt 205), partie interactive : réservation du
 * handle (PATCH /api/account/public-page), génération/régénération de la bio
 * (POST /api/account/public-page/bio, rate-limitée côté serveur) et lien
 * copiable vers /@handle.
 */

export interface PublicPageBioView {
  headline: string;
  bio: string;
  expertise: string[];
  generatedAt: string;
}

export interface PublicPageManagerProps {
  /** Origine publique de l'app (APP_URL), sans slash final. */
  appUrl: string;
  /** Handle déjà réservé, sinon null. */
  handle: string | null;
  /** Proposition déterministe calculée côté serveur depuis le nom. */
  suggestedHandle: string;
  /** La génération de bio exige au moins un cours publié sur le LMS. */
  hasPublishedCourse: boolean;
  bio: PublicPageBioView | null;
}

/** Messages d'erreur de l'API traduits par code (400/409). */
type HandleErrorCode = 'taken' | 'reserved' | 'format';

export function PublicPageManager({
  appUrl,
  handle: initialHandle,
  suggestedHandle,
  hasPublishedCourse,
  bio: initialBio,
}: PublicPageManagerProps) {
  const t = useTranslations('settings.publicPage');
  const { toast } = useToast();

  const [handle, setHandle] = React.useState(initialHandle ?? suggestedHandle);
  const [savedHandle, setSavedHandle] = React.useState(initialHandle);
  const [savingHandle, setSavingHandle] = React.useState(false);
  const [bio, setBio] = React.useState(initialBio);
  const [generating, setGenerating] = React.useState(false);

  const publicUrl = savedHandle ? `${appUrl}/@${savedHandle}` : null;

  function handleErrorMessage(code: HandleErrorCode | undefined): string {
    if (code === 'taken') return t('handleTaken');
    if (code === 'reserved') return t('handleReserved');
    if (code === 'format') return t('handleInvalid');
    return t('handleError');
  }

  async function saveHandle(event: React.FormEvent) {
    event.preventDefault();
    if (savingHandle) return;

    setSavingHandle(true);
    try {
      const response = await fetch('/api/account/public-page', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle }),
      });
      const body = (await response.json().catch(() => null)) as
        | { handle?: string; code?: HandleErrorCode }
        | null;

      if (!response.ok || !body?.handle) {
        toast({ variant: 'danger', title: handleErrorMessage(body?.code) });
        return;
      }

      setSavedHandle(body.handle);
      setHandle(body.handle);
      toast({ variant: 'success', title: t('handleSaved') });
    } catch {
      toast({ variant: 'danger', title: t('handleError') });
    } finally {
      setSavingHandle(false);
    }
  }

  async function generateBio() {
    if (generating) return;

    setGenerating(true);
    try {
      const response = await fetch('/api/account/public-page/bio', { method: 'POST' });
      const body = (await response.json().catch(() => null)) as
        | (PublicPageBioView & { code?: string })
        | null;

      if (!response.ok || !body?.bio) {
        const code = body?.code;
        toast({
          variant: 'danger',
          title:
            code === 'rate_limited'
              ? t('rateLimited')
              : code === 'no_published_course'
                ? t('noCourse')
                : t('bioError'),
        });
        return;
      }

      setBio({
        headline: body.headline,
        bio: body.bio,
        expertise: body.expertise,
        generatedAt: body.generatedAt,
      });
      toast({ variant: 'success', title: t('bioGenerated') });
    } catch {
      toast({ variant: 'danger', title: t('bioError') });
    } finally {
      setGenerating(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast({ variant: 'success', title: t('copied') });
    } catch {
      /* presse-papiers indisponible (permissions) : le lien reste sélectionnable à l'écran */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Handle ------------------------------------------------------- */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <form onSubmit={saveHandle} className="flex flex-wrap items-start gap-3">
            <span aria-hidden="true" className="pt-3.5 text-lg font-medium text-muted">
              @
            </span>
            <Input
              id="handle"
              label={t('handleLabel')}
              hint={t('handleHelp')}
              value={handle}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
              minLength={3}
              maxLength={30}
              required
              wrapperClassName="max-w-sm flex-1"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={savingHandle}
              className="mt-1"
            >
              {t('save')}
            </Button>
          </form>

          {publicUrl ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-4">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
                {t('linkLabel')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all text-sm text-foreground">{publicUrl}</code>
                <Button type="button" variant="secondary" size="sm" onClick={copyLink}>
                  <Copy aria-hidden="true" />
                  {t('copy')}
                </Button>
                <a href={`/@${savedHandle}`} target="_blank" rel="noreferrer">
                  <Button type="button" variant="ghost" size="sm">
                    <ExternalLink aria-hidden="true" />
                    {t('open')}
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('handleFirst')}</p>
          )}
        </CardContent>
      </Card>

      {/* Bio ---------------------------------------------------------- */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-foreground">{t('bioTitle')}</h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={generateBio}
              disabled={generating || !hasPublishedCourse}
            >
              <Sparkles aria-hidden="true" />
              {generating ? t('generating') : bio ? t('regenerate') : t('generate')}
            </Button>
          </div>

          {!hasPublishedCourse && <p className="text-sm text-muted">{t('noCourse')}</p>}

          {bio ? (
            <div className="flex flex-col gap-3">
              <p className="text-base font-medium text-foreground">{bio.headline}</p>
              {bio.bio.split('\n\n').map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="text-sm text-muted">
                  {paragraph}
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                {bio.expertise.map((item) => (
                  <Badge key={item} variant="draft">
                    {item}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted">
                {t('bioGeneratedAt', { date: bio.generatedAt.slice(0, 10) })}
              </p>
            </div>
          ) : (
            hasPublishedCourse && <p className="text-sm text-muted">{t('bioEmpty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
