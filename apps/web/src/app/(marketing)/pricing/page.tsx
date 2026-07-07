import Link from 'next/link';
import type { Metadata } from 'next';
import { Check, Minus, Sparkles } from 'lucide-react';
import { PLANS } from '@sallycourse/shared';
import { buttonVariants, Card, CardContent, CardHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

// Page tarifs (P53) — 3 offres Free/Pro/Business, design SALISTAR premium.
// Les capacités affichées dérivent de PLANS (source unique) pour rester alignées
// avec la logique de quota côté serveur.

export const metadata: Metadata = {
  title: 'Tarifs — SallyCourse',
  description: 'Choisissez votre offre : du plan gratuit au plan Business illimité avec API et multi-comptes.',
};

/** Rend une limite mensuelle : Infinity → « Illimité ». */
function formatCoursesPerMonth(n: number): string {
  return Number.isFinite(n) ? `${n} cours / mois` : 'Cours illimités';
}

interface PlanCard {
  id: keyof typeof PLANS;
  name: string;
  tagline: string;
  price: string;
  period: string;
  cta: string;
  href: string;
  featured?: boolean;
}

// Prix d'affichage (facturation gérée ailleurs) — le plan reste la source des capacités.
const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Pour tester la génération de cours.',
    price: '0 €',
    period: 'pour toujours',
    cta: 'Commencer gratuitement',
    href: '/register',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Pour les créateurs réguliers.',
    price: '29 €',
    period: 'par mois',
    cta: 'Passer au Pro',
    href: '/register?plan=pro',
    featured: true,
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'Pour les équipes et l’automatisation.',
    price: '99 €',
    period: 'par mois',
    cta: 'Contacter les ventes',
    href: '/register?plan=business',
  },
];

/** Une ligne de la matrice de comparaison ; `value(plan)` → booléen ou libellé. */
interface FeatureRow {
  label: string;
  value: (plan: (typeof PLANS)[keyof typeof PLANS]) => boolean | string;
}

const FEATURES: FeatureRow[] = [
  { label: 'Cours générés par mois', value: (p) => formatCoursesPerMonth(p.coursesPerMonth) },
  {
    label: 'Déploiement multi-plateformes',
    value: (p) => (Number.isFinite(p.maxDeployPlatforms) ? `${p.maxDeployPlatforms} à la fois` : 'Partout'),
  },
  { label: 'Sans filigrane', value: (p) => !p.watermark },
  { label: 'Accès API', value: (p) => p.api },
  { label: 'Multi-comptes plateformes', value: (p) => p.multiAccounts },
];

/** Cellule de valeur : coche/tiret pour un booléen, texte sinon. */
function FeatureValue({ value }: { value: boolean | string }) {
  if (typeof value === 'string') {
    return <span className="text-sm text-foreground">{value}</span>;
  }
  return value ? (
    <Check className="size-4 text-accent" aria-label="Inclus" />
  ) : (
    <Minus className="size-4 text-muted" aria-label="Non inclus" />
  );
}

export default function PricingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
      {/* En-tête */}
      <header className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-accent">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Tarifs simples
        </span>
        <h1 className="mt-5 font-display text-4xl font-semibold text-foreground sm:text-5xl">
          Un cours complet, en quelques minutes
        </h1>
        <p className="mt-4 text-base text-muted">
          Commencez gratuitement, passez à l’échelle quand vous êtes prêt. Aucun engagement, changez d’offre à tout moment.
        </p>
      </header>

      {/* Cartes de plans */}
      <section className="mt-14 grid gap-6 md:grid-cols-3">
        {PLAN_CARDS.map((plan) => (
          <Card
            key={plan.id}
            interactive
            wrapperClassName={cn(plan.featured && 'md:-translate-y-2 md:shadow-lg')}
            className={cn('flex h-full flex-col', plan.featured && 'ring-1 ring-accent/30')}
          >
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-foreground">{plan.name}</h2>
                {plan.featured && (
                  <span className="rounded-full bg-gradient-to-b from-accent-300 to-accent-500 px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent-foreground">
                    Populaire
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">{plan.tagline}</p>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-semibold text-foreground">{plan.price}</span>
                <span className="text-sm text-muted">{plan.period}</span>
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-4">
              <ul className="flex flex-col gap-3">
                {FEATURES.map((feature) => {
                  const value = feature.value(PLANS[plan.id]);
                  const included = typeof value === 'boolean' ? value : true;
                  return (
                    <li key={feature.label} className="flex items-start gap-2.5 text-sm">
                      {included ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                      ) : (
                        <Minus className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                      )}
                      <span className={cn(included ? 'text-foreground' : 'text-muted')}>
                        {typeof value === 'string' ? value : feature.label}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-auto pt-2">
                <Link
                  href={plan.href}
                  className={cn(
                    buttonVariants({ variant: plan.featured ? 'gold' : 'secondary', size: 'lg' }),
                    'w-full',
                  )}
                >
                  {plan.cta}
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Matrice de comparaison détaillée */}
      <section className="mt-20">
        <h2 className="text-center font-display text-2xl font-semibold text-foreground">
          Comparer les offres en détail
        </h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="py-4 pr-4 text-sm font-medium text-muted">Fonctionnalité</th>
                {PLAN_CARDS.map((plan) => (
                  <th key={plan.id} className="px-4 py-4 text-center font-display text-base font-semibold text-foreground">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((feature) => (
                <tr key={feature.label} className="border-b border-border/60">
                  <td className="py-4 pr-4 text-sm text-foreground">{feature.label}</td>
                  {PLAN_CARDS.map((plan) => (
                    <td key={plan.id} className="px-4 py-4 text-center">
                      <span className="inline-flex justify-center">
                        <FeatureValue value={feature.value(PLANS[plan.id])} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA de bas de page */}
      <section className="mt-20 text-center">
        <p className="text-sm text-muted">Prêt à générer votre premier cours ?</p>
        <div className="mt-4">
          <Link href="/register" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Créer un compte gratuit
          </Link>
        </div>
      </section>
    </main>
  );
}
