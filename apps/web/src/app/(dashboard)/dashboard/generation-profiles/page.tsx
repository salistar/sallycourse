import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Sparkles, Wallet, Zap } from 'lucide-react';
import { estimateCourseVolume, estimateCourseCost } from '@sallycourse/shared/course-estimate';
import { requireUser } from '@/lib/session';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fetchAllProviderCredits, type CreditStatus } from '../../admin/ops/provider-credits';

/**
 * /dashboard/generation-profiles (Phase E, audit qualité 2026-07-29) —
 * comparateur de profils de génération (Éco/Standard/Premium), branché sur
 * des données RÉELLES plutôt que des chiffres inventés :
 *   - coût projeté : mêmes fonctions pures que le devis de création
 *     (course-estimate.ts, déjà utilisé par l'écran /dashboard/new) sur un
 *     cours représentatif (8 sections) ;
 *   - disponibilité : sondes de crédit en direct (Phase C, provider-credits.ts)
 *     — un profil dont le provider LLM principal est à sec est grisé avec
 *     l'explication exacte, plutôt que de laisser choisir une option cassée.
 * Chaque carte lance /dashboard/new pré-rempli (llmProvider/ttsEngine/
 * imageEngine) — l'auteur garde la main via les options avancées ensuite.
 */

export const metadata: Metadata = {
  title: 'Profils de génération — SallyCourse',
  description: 'Comparez coût et rapidité des profils de génération avant de créer un cours.',
};

export const dynamic = 'force-dynamic';

interface GenerationProfile {
  id: 'eco' | 'standard' | 'premium';
  label: string;
  tagline: string;
  icon: React.ReactNode;
  llmProviderId: string;
  llmModelForEstimate: string;
  ttsEngine: 'chatterbox' | 'qwen3';
  imageEngine: 'sdxl' | 'zimage';
  bundle: string;
  recommended?: boolean;
}

const PROFILES: GenerationProfile[] = [
  {
    id: 'eco',
    label: 'Éco',
    tagline: 'Gratuit, pour tester une idée de cours',
    icon: <Wallet className="size-5" aria-hidden="true" />,
    llmProviderId: 'cloudflare',
    llmModelForEstimate: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    ttsEngine: 'qwen3',
    imageEngine: 'sdxl',
    bundle: 'Cloudflare Llama 3.3 70B (gratuit) · Qwen3-TTS · SDXL',
  },
  {
    id: 'standard',
    label: 'Standard',
    tagline: 'Le meilleur rapport qualité/coût',
    icon: <Zap className="size-5" aria-hidden="true" />,
    llmProviderId: 'deepseek',
    llmModelForEstimate: 'deepseek-chat',
    ttsEngine: 'qwen3',
    imageEngine: 'sdxl',
    bundle: 'DeepSeek Chat · Qwen3-TTS · SDXL',
    recommended: true,
  },
  {
    id: 'premium',
    label: 'Premium',
    tagline: 'Qualité de rédaction maximale',
    icon: <Sparkles className="size-5" aria-hidden="true" />,
    llmProviderId: 'anthropic',
    llmModelForEstimate: 'claude-sonnet-5',
    ttsEngine: 'qwen3',
    imageEngine: 'sdxl',
    bundle: 'Anthropic Claude Sonnet 5 · Qwen3-TTS · SDXL',
  },
];

/** Cours représentatif pour le devis (8 sections — défaut historique de /dashboard/new). */
const REPRESENTATIVE_VOLUME = estimateCourseVolume({ approxSections: 8 });

const CREDIT_LABEL: Record<CreditStatus, string> = {
  ok: 'Disponible',
  low: 'Crédit bas',
  exhausted: 'Indisponible (crédit épuisé)',
  unknown: 'Statut inconnu',
  not_configured: 'Non configuré',
};

export default async function GenerationProfilesPage() {
  await requireUser();

  const credits = await fetchAllProviderCredits().catch(() => []);
  const creditById = new Map(credits.map((c) => [c.id, c]));

  const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Profils de génération</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Trois combinaisons de moteurs (rédaction, voix, images), avec un coût et un statut de
          disponibilité RÉELS — pas des estimations théoriques. Choisissez, puis ajustez si besoin
          dans les options avancées de la création.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PROFILES.map((profile) => {
          const credit = creditById.get(profile.llmProviderId);
          const unavailable = credit?.status === 'exhausted';
          const estimate = estimateCourseCost(REPRESENTATIVE_VOLUME, {
            llmModel: profile.llmModelForEstimate,
            ttsProvider: profile.ttsEngine,
          });
          const href =
            `/dashboard/new?llmProvider=${encodeURIComponent(profile.llmProviderId)}` +
            `&ttsEngine=${encodeURIComponent(profile.ttsEngine)}` +
            `&imageEngine=${encodeURIComponent(profile.imageEngine)}`;

          return (
            <Card
              key={profile.id}
              className={cn(
                'relative flex flex-col',
                profile.recommended && !unavailable && 'border-accent/60 shadow-sm',
                unavailable && 'opacity-60',
              )}
            >
              {profile.recommended && !unavailable && (
                <span className="absolute -top-3 left-4 rounded-full border border-accent/50 bg-accent/15 px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent shadow-sm">
                  Recommandé
                </span>
              )}
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-lg text-foreground">
                    {profile.icon}
                    {profile.label}
                  </CardTitle>
                  {credit && (
                    <Badge variant={credit.status === 'ok' ? 'published' : credit.status === 'low' ? 'generating' : unavailable ? 'failed' : 'draft'}>
                      {CREDIT_LABEL[credit.status]}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted">{profile.tagline}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <p className="text-xs text-muted">{profile.bundle}</p>

                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-semibold tabular-nums text-foreground">
                    {estimate.cloudUsd < 0.01 ? 'Gratuit' : usd.format(estimate.cloudUsd)}
                  </span>
                  {estimate.cloudUsd >= 0.01 && <span className="text-xs text-muted">/ cours (≈8 sections)</span>}
                </div>

                <ul className="flex flex-col gap-1.5 text-xs text-muted">
                  <li className="flex items-center gap-1.5">
                    <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                    ~{REPRESENTATIVE_VOLUME.lessons} leçons, {REPRESENTATIVE_VOLUME.videos} vidéos
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                    Voix Qwen3-TTS (silence propre — voir audit du 29/07)
                  </li>
                  {unavailable && (
                    <li className="flex items-center gap-1.5 text-danger">
                      {credit?.detail}
                    </li>
                  )}
                </ul>

                <div className="mt-auto pt-2">
                  {unavailable ? (
                    <span className="block rounded-md border border-border bg-surface-subtle px-3 py-2 text-center text-sm font-medium text-muted">
                      Indisponible pour l'instant
                    </span>
                  ) : (
                    <Link
                      href={href}
                      className={cn(
                        'block rounded-md px-3 py-2 text-center text-sm font-semibold transition-colors duration-fast',
                        profile.recommended
                          ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                          : 'border border-border bg-surface hover:bg-surface-subtle',
                      )}
                    >
                      Créer un cours avec ce profil
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-2xs text-muted">
        Coût projeté sur un cours représentatif (8 sections, méthode identique au devis affiché à la
        création). Le coût réel dépend de la longueur effective du cours. Statuts de crédit
        rafraîchis toutes les 15 minutes —{' '}
        <Link href="/admin/ops" className="font-medium text-accent hover:underline">
          détail admin
        </Link>
        .
      </p>
    </div>
  );
}
