import type { Metadata } from 'next';
import { AdminNav } from '@/components/admin';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { requireAdmin } from '../guard';
import { degradedCount, severityOf, sortBreakers, type BreakerSeverity } from './breaker-view';
import { readCircuitBreakerSnapshots } from './read-circuit-breakers';

/**
 * Dashboard admin « Résilience » (P77 — mode dégradé) : état courant de chaque
 * circuit breaker du worker (ElevenLabs→OpenAI, …), dernière erreur et prochain
 * essai. Les instantanés sont persistés par le worker dans Redis à chaque
 * transition d'état (voir apps/worker/src/lib/circuit-breaker.ts) — cette page
 * ne fait que les lire, aucun accès à la mémoire du process worker.
 *
 * Déploiement multi-plateformes (P77) : chaque plateforme (Udemy, YouTube, …)
 * est un job BullMQ indépendant sur la queue `deployment` (un job = un couple
 * cours/plateforme, voir processDeployment). Un échec sur une plateforme jette
 * dans SON job uniquement — les autres jobs de la même vague de déploiement
 * continuent sans être affectés (isolation native BullMQ, aucun changement
 * requis ici) ; le statut par plateforme reste visible sur /admin/jobs et la
 * page de déploiement du cours.
 */

export const metadata: Metadata = {
  title: 'Admin — Résilience — SallyCourse',
};

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  closed: 'Fermé (nominal)',
  'half-open': 'Semi-ouvert (essai en cours)',
  open: 'Ouvert (indisponible)',
};

const SEVERITY_BADGE: Record<BreakerSeverity, 'published' | 'generating' | 'failed'> = {
  ok: 'published',
  warning: 'generating',
  critical: 'failed',
};

const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });

function formatTs(ts: number | null): string {
  if (ts === null) return '—';
  return dateTimeFmt.format(new Date(ts));
}

export default async function AdminResiliencePage() {
  await requireAdmin();

  const snapshots = await readCircuitBreakerSnapshots();
  const sorted = sortBreakers(snapshots);
  const degraded = degradedCount(snapshots);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Résilience</h1>
        <p className="mt-1 text-sm text-muted">
          Mode dégradé : état des circuit breakers du worker (bascule automatique vers un repli quand un
          fournisseur externe est en panne) et isolation des déploiements multi-plateformes.
        </p>
      </div>

      <AdminNav />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">Breakers surveillés</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{sorted.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">En dégradation</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'font-display text-2xl font-semibold tabular-nums',
                degraded > 0 ? 'text-danger' : 'text-foreground',
              )}
            >
              {degraded}
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">Circuit breakers</h2>
        {sorted.length === 0 ? (
          <EmptyState
            title="Aucun breaker enregistré"
            description="Les breakers apparaissent dès leur première transition d'état (ex. premier échec ElevenLabs). Aucune entrée ici signifie qu'aucun incident n'a encore été détecté."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-semibold">Breaker</th>
                  <th className="px-4 py-3 text-start font-semibold">État</th>
                  <th className="px-4 py-3 text-end font-semibold">Échecs</th>
                  <th className="px-4 py-3 text-start font-semibold">Dernière erreur</th>
                  <th className="px-4 py-3 text-start font-semibold">Prochain essai</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => {
                  const severity = severityOf(b.state);
                  return (
                    <tr
                      key={b.name}
                      className={cn(
                        'border-b border-border/60 last:border-b-0',
                        severity === 'critical' && 'bg-danger/5',
                      )}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{b.name}</td>
                      <td className="px-4 py-3">
                        <Badge variant={SEVERITY_BADGE[severity]}>{STATE_LABELS[b.state] ?? b.state}</Badge>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-muted">{b.failureCount}</td>
                      <td className="max-w-96 truncate px-4 py-3 text-muted" title={b.lastError ?? undefined}>
                        {b.lastError ? `${b.lastError} (${formatTs(b.lastErrorAt)})` : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted">{formatTs(b.nextAttemptAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-2xs text-muted">
          Repli configuré : synthèse vocale ElevenLabs → OpenAI TTS (5 échecs consécutifs ouvrent le circuit,
          nouvel essai après 60s). Appels Claude : file d’attente locale avec délai croissant sur 429 répétés
          (1s/2s/4s/8s), sans nouvelle infra.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface/60 p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Déploiement multi-plateformes</h2>
        <p className="text-sm text-muted">
          Chaque plateforme (Udemy, YouTube, Podia, …) est traitée par un job BullMQ indépendant sur la queue{' '}
          <code className="rounded bg-surface-subtle px-1 py-0.5 text-2xs">deployment</code> (un job = un couple
          cours/plateforme). Si une plateforme échoue, seul son job passe en échec — les autres jobs de la même
          vague de déploiement ne sont ni bloqués ni annulés (isolation native de la queue). Statut détaillé par
          plateforme :{' '}
          <a href="/admin/jobs" className="font-medium text-accent hover:underline">
            voir les jobs
          </a>
          .
        </p>
      </section>
    </div>
  );
}
