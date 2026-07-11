'use client';

import * as React from 'react';
import { ImageIcon, Lock, Palette, Trash2, UploadCloud } from 'lucide-react';
import { colors } from '@sallycourse/design';
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

// Défauts alignés sur les tokens de marque (P113 : plus de hex en dur ici).
const DEFAULT_PRIMARY = colors.violet[500];
const DEFAULT_ACCENT = colors.gold[500];

interface BrandingState {
  schoolName: string;
  logoUrl: string | null;
  primaryColorHex: string;
  accentColorHex: string;
}

type Phase = 'loading' | 'idle' | 'saving' | 'uploading';

export function BrandingManager({ userPlan }: { userPlan: string }) {
  const { toast } = useToast();
  const isBusiness = userPlan === 'business';
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [branding, setBranding] = React.useState<BrandingState>({
    schoolName: '',
    logoUrl: null,
    primaryColorHex: DEFAULT_PRIMARY,
    accentColorHex: DEFAULT_ACCENT,
  });
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
    HEX_RE.test(value) ? undefined : 'Couleur hexadécimale invalide (#RRGGBB).';

  const onSave = React.useCallback(async () => {
    if (!branding.schoolName.trim()) {
      toast({ title: 'Nom d’école requis', variant: 'danger' });
      return;
    }
    if (hexError(branding.primaryColorHex) || hexError(branding.accentColorHex)) {
      toast({ title: 'Couleur invalide', description: 'Utilisez le format #RRGGBB.', variant: 'danger' });
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
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; branding?: BrandingState }
        | null;

      if (!res.ok) {
        toast({ title: 'Enregistrement impossible', description: data?.error, variant: 'danger' });
        return;
      }

      if (data?.branding) setBranding(data.branding);
      setHasBranding(true);
      toast({ title: 'Marque blanche enregistrée', variant: 'success' });
    } catch {
      toast({ title: 'Erreur réseau', description: 'Serveur injoignable.', variant: 'danger' });
    } finally {
      setPhase('idle');
    }
  }, [branding, toast]);

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
          toast({ title: 'Téléversement impossible', description: data?.error, variant: 'danger' });
          return;
        }

        if (data?.branding) setBranding(data.branding);
        setHasBranding(true);
        toast({ title: 'Logo mis à jour', variant: 'success' });
      } catch {
        toast({ title: 'Erreur réseau', variant: 'danger' });
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
        toast({ title: 'Marque blanche réinitialisée (retour à SALISTAR)', variant: 'success' });
      } else {
        toast({ title: 'Réinitialisation impossible', variant: 'danger' });
      }
    } catch {
      toast({ title: 'Erreur réseau', variant: 'danger' });
    } finally {
      setPhase('idle');
    }
  }, [toast]);

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Palette className="size-5 text-accent" aria-hidden="true" />
          Certificat — marque blanche
        </CardTitle>
        <CardDescription>
          Le logo et les couleurs choisis ci-dessous remplacent la marque SALISTAR sur le
          certificat PDF délivré à vos étudiants. Fonctionnalité réservée au plan Business.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-2">
          <Badge variant={hasBranding ? 'ready' : 'draft'}>
            {hasBranding ? 'Marque blanche active' : 'SALISTAR par défaut'}
          </Badge>
          {!isBusiness && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Lock className="size-3.5" aria-hidden="true" />
              Réservé au plan Business
            </span>
          )}
        </div>

        <fieldset disabled={!isBusiness || phase === 'loading'} className="flex flex-col gap-6 disabled:opacity-50">
          <Input
            label="Nom de l’école"
            value={branding.schoolName}
            onChange={(e) => setBranding((b) => ({ ...b, schoolName: e.target.value }))}
            maxLength={80}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-xs font-semibold text-muted">Couleur principale</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Couleur principale"
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
              <span className="px-1 text-xs font-semibold text-muted">Couleur d’accent</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Couleur d’accent"
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

          <div className="flex flex-col gap-3">
            <span className="px-1 text-xs font-semibold text-muted">Logo</span>
            <div className="flex items-center gap-4">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-sm border border-input bg-surface">
                {branding.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- logo utilisateur externe (URL présignée S3)
                  <img src={branding.logoUrl} alt="Logo de l’école" className="size-full object-contain" />
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
                {phase === 'uploading' ? 'Téléversement…' : 'Téléverser un logo'}
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
              Enregistrer
            </Button>
            {hasBranding && (
              <Button variant="ghost" size="sm" onClick={() => void onReset()}>
                <Trash2 aria-hidden="true" />
                Revenir à SALISTAR
              </Button>
            )}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
