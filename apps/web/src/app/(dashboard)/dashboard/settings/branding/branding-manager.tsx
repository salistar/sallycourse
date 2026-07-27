'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import { ImageIcon, Lock, Palette, Trash2, UploadCloud } from 'lucide-react';
// Import du sous-module direct (pas le baril '@sallycourse/design') : le
// baril réexporte aussi render-templates.ts (Node-only, node:url) qui ne
// doit jamais atteindre le bundle navigateur d'un composant client.
import { colors } from '@sallycourse/design/tokens';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  useToast,
} from '@/components/ui';

// Section « Marque blanche » (Prompt 88) : nom d'école, couleurs (primaire +
// accent) et logo appliqués au certificat PDF à la place de SALISTAR. Réservé
// au plan Business — les autres plans voient un mur d'upsell (mutations 403
// côté API de toute façon, la garde ici n'est qu'ergonomique).

const ENDPOINT = '/api/account/branding';
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// Additif (P143) : validation légère côté client (le serveur revalide via
// subdomainSchema — @sallycourse/shared). Domaine racine affiché en aperçu
// uniquement, pas de logique métier ici.
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ROOT_DOMAIN_DISPLAY = 'sallycourse.com';

// Défauts alignés sur les tokens de marque (P113 : plus de hex en dur ici).
const DEFAULT_PRIMARY = colors.violet[500];
const DEFAULT_ACCENT = colors.gold[500];

interface BrandingState {
  schoolName: string;
  logoUrl: string | null;
  primaryColorHex: string;
  accentColorHex: string;
  /** Additif (P143) : sous-domaine white-label — null si non configuré. */
  customSubdomain?: string | null;
}

type Phase = 'loading' | 'idle' | 'saving' | 'uploading';

export function BrandingManager({ userPlan }: { userPlan: string }) {
  const { toast } = useToast();
  const t = useTranslations('settings.branding');
  const tApiError = useTranslations('apiErrors');
  const isBusiness = userPlan === 'business';
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [branding, setBranding] = React.useState<BrandingState>({
    schoolName: '',
    logoUrl: null,
    primaryColorHex: DEFAULT_PRIMARY,
    accentColorHex: DEFAULT_ACCENT,
    customSubdomain: null,
  });
  const [subdomainInput, setSubdomainInput] = React.useState('');

  React.useEffect(() => {
    setSubdomainInput(branding.customSubdomain ?? '');
  }, [branding.customSubdomain]);
  const [hasBranding, setHasBranding] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { method: 'GET' });
        const data = (await res.json().catch(() => null)) as {
          branding: BrandingState | null;
        } | null;
        if (cancelled) return;
        if (data?.branding) {
          setBranding(data.branding);
          setHasBranding(true);
        }
      } finally {
        if (!cancelled) setPhase('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hexError = (value: string) =>
    HEX_RE.test(value) ? undefined : t('hexInvalid');

  const onSave = React.useCallback(async () => {
    if (!branding.schoolName.trim()) {
      toast({ title: t('schoolNameRequired'), variant: 'danger' });
      return;
    }
    if (hexError(branding.primaryColorHex) || hexError(branding.accentColorHex)) {
      toast({ title: t('colorInvalidTitle'), description: t('colorInvalidDesc'), variant: 'danger' });
      return;
    }
    const subdomain = subdomainInput.trim().toLowerCase();
    if (subdomain && (subdomain.length < 3 || !SUBDOMAIN_RE.test(subdomain))) {
      toast({
        title: t('subdomainInvalidTitle'),
        description: t('subdomainInvalidDesc'),
        variant: 'danger',
      });
      return;
    }

    setPhase('saving');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schoolName: branding.schoolName.trim(),
          primaryColorHex: branding.primaryColorHex,
          accentColorHex: branding.accentColorHex,
          customSubdomain: subdomain,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; branding?: BrandingState }
        | null;

      if (!res.ok) {
        toast({ title: t('saveErrorTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
        return;
      }

      if (data?.branding) setBranding(data.branding);
      setHasBranding(true);
      toast({ title: t('saveSuccess'), variant: 'success' });
    } catch {
      toast({ title: t('networkErrorTitle'), description: t('networkErrorDesc'), variant: 'danger' });
    } finally {
      setPhase('idle');
    }
    // subdomainInput fait partie des lectures : sans lui, le callback mémoïsé
    // enverrait l'ancienne valeur si SEUL le sous-domaine a changé.
  }, [branding, subdomainInput, toast]);

  const onPickLogo = React.useCallback(
    async (file: File) => {
      setPhase('uploading');
      try {
        const body = new FormData();
        body.append('file', file);

        const res = await fetch(ENDPOINT, { method: 'POST', body });
        const data = (await res.json().catch(() => null)) as
          | { error?: string; branding?: BrandingState }
          | null;

        if (!res.ok) {
          toast({ title: t('uploadErrorTitle'), description: errorMessage(data, tApiError), variant: 'danger' });
          return;
        }

        if (data?.branding) setBranding(data.branding);
        setHasBranding(true);
        toast({ title: t('logoUpdated'), variant: 'success' });
      } catch {
        toast({ title: t('networkErrorTitle'), variant: 'danger' });
      } finally {
        setPhase('idle');
      }
    },
    [toast],
  );

  const onReset = React.useCallback(async () => {
    setPhase('saving');
    try {
      const res = await fetch(ENDPOINT, { method: 'DELETE' });
      if (res.ok) {
        setBranding({
          schoolName: '',
          logoUrl: null,
          primaryColorHex: DEFAULT_PRIMARY,
          accentColorHex: DEFAULT_ACCENT,
        });
        setHasBranding(false);
        toast({ title: t('resetSuccess'), variant: 'success' });
      } else {
        toast({ title: t('resetErrorTitle'), variant: 'danger' });
      }
    } catch {
      toast({ title: t('networkErrorTitle'), variant: 'danger' });
    } finally {
      setPhase('idle');
    }
  }, [toast]);

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Palette className="size-5 text-accent" aria-hidden="true" />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-2">
          <Badge variant={hasBranding ? 'ready' : 'draft'}>
            {hasBranding ? t('statusActive') : t('statusDefault')}
          </Badge>
          {!isBusiness && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3.5" aria-hidden="true" />
              {t('businessOnly')}
            </span>
          )}
        </div>

        <fieldset disabled={!isBusiness || phase === 'loading'} className="flex flex-col gap-6 disabled:opacity-50">
          <Input
            label={t('schoolNameLabel')}
            value={branding.schoolName}
            onChange={(e) => setBranding((b) => ({ ...b, schoolName: e.target.value }))}
            maxLength={80}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-xs font-semibold text-muted">{t('primaryColor')}</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={t('primaryColor')}
                  value={HEX_RE.test(branding.primaryColorHex) ? branding.primaryColorHex : DEFAULT_PRIMARY}
                  onChange={(e) => setBranding((b) => ({ ...b, primaryColorHex: e.target.value }))}
                  className="size-13 shrink-0 cursor-pointer rounded-sm border border-input bg-surface p-1"
                />
                <Input
                  label="Hex"
                  value={branding.primaryColorHex}
                  onChange={(e) => setBranding((b) => ({ ...b, primaryColorHex: e.target.value }))}
                  error={branding.primaryColorHex ? hexError(branding.primaryColorHex) : undefined}
                  wrapperClassName="flex-1"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-xs font-semibold text-muted">{t('accentColor')}</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={t('accentColor')}
                  value={HEX_RE.test(branding.accentColorHex) ? branding.accentColorHex : DEFAULT_ACCENT}
                  onChange={(e) => setBranding((b) => ({ ...b, accentColorHex: e.target.value }))}
                  className="size-13 shrink-0 cursor-pointer rounded-sm border border-input bg-surface p-1"
                />
                <Input
                  label="Hex"
                  value={branding.accentColorHex}
                  onChange={(e) => setBranding((b) => ({ ...b, accentColorHex: e.target.value }))}
                  error={branding.accentColorHex ? hexError(branding.accentColorHex) : undefined}
                  wrapperClassName="flex-1"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Input
                label={t('subdomainLabel')}
                value={subdomainInput}
                onChange={(e) => setSubdomainInput(e.target.value.toLowerCase())}
                placeholder={t('subdomainPlaceholder')}
                wrapperClassName="flex-1"
              />
              <span className="whitespace-nowrap text-sm text-muted">.{ROOT_DOMAIN_DISPLAY}</span>
            </div>
            <p className="px-1 text-xs text-muted">
              {t('subdomainHelp')}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <span className="px-1 text-xs font-semibold text-muted">{t('logo')}</span>
            <div className="flex items-center gap-4">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-sm border border-input bg-surface">
                {branding.logoUrl ? (
                  // Logo utilisateur externe (URL présignée S3) : <img> natif nécessaire.
                  <img src={branding.logoUrl} alt={t('logoAlt')} className="size-full object-contain" />
                ) : (
                  <ImageIcon className="size-6 text-muted" aria-hidden="true" />
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={phase === 'uploading'}
                onClick={() => inputRef.current?.click()}
              >
                {phase !== 'uploading' && <UploadCloud aria-hidden="true" />}
                {phase === 'uploading' ? t('uploading') : t('uploadLogo')}
              </Button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPickLogo(file);
                e.target.value = '';
              }}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button loading={phase === 'saving'} onClick={() => void onSave()}>
              {t('save')}
            </Button>
            {hasBranding && (
              <Button variant="ghost" size="sm" onClick={() => void onReset()}>
                <Trash2 aria-hidden="true" />
                {t('backToSalistar')}
              </Button>
            )}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
