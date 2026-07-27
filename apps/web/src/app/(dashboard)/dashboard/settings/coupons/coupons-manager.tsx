'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';
import { CalendarClock, Plus, Ticket, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, useToast } from '@/components/ui';

/** Vue d'un coupon telle que renvoyée par GET /api/coupons. */
interface CouponView {
  id: string;
  code: string;
  discountPercent: number | null;
  discountAmount: number | null;
  validFrom: string;
  validUntil: string;
  maxUses: number | null;
  usedCount: number;
  platform: string;
  courseId?: string | null;
}

/** Période promo suggérée par POST /api/coupons/promo-calendar (P139). */
interface PromoPeriod {
  name: string;
  startDate: string;
  endDate: string;
  discountPercent: number;
  rationale: string;
}

interface CourseOption {
  id: string;
  title: string;
}

// Libellés de plateforme résolus via platformLabel() au rendu (« Udemy » est une marque, laissée telle quelle).

function discountLabel(c: CouponView, fixedLabel: string): string {
  if (c.discountPercent != null) return `-${c.discountPercent} %`;
  // Montant fixe : stocké en plus petite unité, appliqué dans la devise du cours
  // (MAD pour le LMS interne) — pas de symbole en dur, on reste neutre.
  if (c.discountAmount != null) return `-${(c.discountAmount / 100).toFixed(2)} ${fixedLabel}`;
  return '—';
}

export function CouponsManager({ courses }: { courses: CourseOption[] }) {
  const { toast } = useToast();
  const t = useTranslations('settings.coupons');
  const tApiError = useTranslations('apiErrors');
  const format = useFormatter();
  const platformLabel = (p: string) => (p === 'internal' ? t('platformInternal') : p === 'udemy' ? 'Udemy' : p);
  const [coupons, setCoupons] = React.useState<CouponView[] | null>(null);
  const [creating, setCreating] = React.useState(false);
  // Formulaire de création — volontairement simple (une carte, pas de modal).
  const [code, setCode] = React.useState('');
  const [discountType, setDiscountType] = React.useState<'percent' | 'amount'>('percent');
  const [percent, setPercent] = React.useState('20');
  const [amount, setAmount] = React.useState('50');
  const [days, setDays] = React.useState('30');
  const [maxUses, setMaxUses] = React.useState('');
  const [platform, setPlatform] = React.useState('internal');
  const [courseId, setCourseId] = React.useState('');
  // Calendrier promo suggéré (P139) — pour le cours sélectionné.
  const [promoPeriods, setPromoPeriods] = React.useState<PromoPeriod[] | null>(null);
  const [promoLoading, setPromoLoading] = React.useState(false);

  const titleById = React.useMemo(
    () => new Map(courses.map((c) => [c.id, c.title])),
    [courses],
  );

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch('/api/coupons');
      const data = (await res.json().catch(() => null)) as { coupons?: CouponView[] } | null;
      setCoupons(Array.isArray(data?.coupons) ? data.coupons : []);
    } catch {
      setCoupons([]);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    const validDays = Number.parseInt(days, 10);
    if (!Number.isFinite(validDays) || validDays < 1) {
      toast({ variant: 'danger', title: t('toastInvalidDuration') });
      return;
    }
    // Remise : pourcentage OU montant fixe (exclusif — contrat de l'API).
    let discount: { discountPercent: number } | { discountAmount: number };
    if (discountType === 'percent') {
      const p = Number.parseInt(percent, 10);
      if (!Number.isFinite(p) || p < 1 || p > 100) {
        toast({ variant: 'danger', title: t('toastInvalidDiscount') });
        return;
      }
      discount = { discountPercent: p };
    } else {
      const a = Number.parseFloat(amount);
      if (!Number.isFinite(a) || a <= 0) {
        toast({ variant: 'danger', title: t('toastInvalidAmount') });
        return;
      }
      discount = { discountAmount: Math.round(a * 100) }; // → plus petite unité
    }
    setCreating(true);
    try {
      const now = new Date();
      const res = await fetch('/api/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
          ...discount,
          validFrom: now.toISOString(),
          validUntil: new Date(now.getTime() + validDays * 86_400_000).toISOString(),
          ...(maxUses.trim() ? { maxUses: Number.parseInt(maxUses, 10) } : {}),
          platform,
          ...(courseId ? { courseId } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { coupon?: CouponView; error?: string } | null;
      if (!res.ok) {
        toast({ variant: 'danger', title: t('toastCreateFailed'), description: errorMessage(data, tApiError) });
        return;
      }
      toast({ variant: 'success', title: t('toastCreated'), description: data?.coupon?.code });
      setCode('');
      await reload();
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkError') });
    } finally {
      setCreating(false);
    }
  };

  /** Suggestions de périodes promo (P139) pour le cours ciblé sélectionné. */
  const suggestPromo = async () => {
    if (!courseId) {
      toast({ variant: 'danger', title: t('toastSelectCourse'), description: t('toastSelectCourseDesc') });
      return;
    }
    setPromoLoading(true);
    try {
      const res = await fetch('/api/coupons/promo-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId }),
      });
      const data = (await res.json().catch(() => null)) as { periods?: PromoPeriod[]; error?: string } | null;
      if (!res.ok || !Array.isArray(data?.periods)) {
        toast({ variant: 'danger', title: t('toastSuggestUnavailable'), description: errorMessage(data, tApiError) });
        return;
      }
      setPromoPeriods(data.periods);
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkError') });
    } finally {
      setPromoLoading(false);
    }
  };

  /** Applique une période suggérée au formulaire (remise % + validité jusqu'à la fin). */
  const applyPromo = (p: PromoPeriod) => {
    setDiscountType('percent');
    setPercent(String(p.discountPercent));
    const end = new Date(p.endDate).getTime();
    const remainingDays = Math.max(1, Math.ceil((end - Date.now()) / 86_400_000));
    setDays(String(remainingDays));
    toast({ title: t('toastPromoApplied', { name: p.name }), description: p.rationale });
  };

  const inputCls =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80';

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="size-5 text-accent" aria-hidden="true" />
            {t('newCoupon')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('labelCode')}
            <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="PROMO20" />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('labelDiscountType')}
            <select className={inputCls} value={discountType} onChange={(e) => setDiscountType(e.target.value as 'percent' | 'amount')}>
              <option value="percent">{t('optionPercent')}</option>
              <option value="amount">{t('optionFixedAmount')}</option>
            </select>
          </label>

          {discountType === 'percent' ? (
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('labelDiscountPercent')}
              <input className={inputCls} type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('labelAmount')}
              <input className={inputCls} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('labelValidity')}
            <input className={inputCls} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('labelQuota')}
            <input className={inputCls} type="number" min={0} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="∞" />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('labelPlatform')}
            <select className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="internal">{platformLabel('internal')}</option>
              <option value="udemy">Udemy</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
            {t('labelTargetCourse')}
            <select className={inputCls} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">{t('optionAllMyCourses')}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
            <Button variant="primary" size="sm" loading={creating} onClick={() => void create()}>
              {!creating && <Ticket aria-hidden="true" />}
              {t('createButton')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={promoLoading}
              disabled={!courseId}
              onClick={() => void suggestPromo()}
              title={courseId ? undefined : t('selectTargetTitle')}
            >
              {!promoLoading && <CalendarClock aria-hidden="true" />}
              {t('suggestPromoButton')}
            </Button>
          </div>

          {promoPeriods && promoPeriods.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3 sm:col-span-4">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
                {t('suggestedPromoPeriods')}{courseId ? ` — ${titleById.get(courseId) ?? ''}` : ''}
              </p>
              {promoPeriods.map((p) => (
                <div key={`${p.name}-${p.startDate}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-foreground">
                    <strong className="font-semibold">{p.name}</strong> · −{p.discountPercent} % ·{' '}
                    {format.dateTime(new Date(p.startDate), { day: '2-digit', month: '2-digit', year: 'numeric' })} → {format.dateTime(new Date(p.endDate), { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    <span className="block text-2xs text-muted">{p.rationale}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => applyPromo(p)}>
                    {t('useButton')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {coupons === null ? null : coupons.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {coupons.map((c) => {
            const expired = new Date(c.validUntil).getTime() < Date.now();
            const targetTitle = c.courseId ? titleById.get(String(c.courseId)) : undefined;
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-foreground">{c.code}</span>
                  <Badge variant="ready">{discountLabel(c, t('fixedSuffix'))}</Badge>
                  {expired && <Badge variant="failed">{t('expired')}</Badge>}
                  <span className="text-2xs text-muted">
                    {t('validUntilPrefix')} {format.dateTime(new Date(c.validUntil), { day: '2-digit', month: '2-digit', year: 'numeric' })} · {c.usedCount}
                    {c.maxUses != null ? `/${c.maxUses}` : ''} {t('uses', { count: c.usedCount })} · {platformLabel(c.platform)}
                    {targetTitle ? ` · ${targetTitle}` : ` · ${t('allYourCourses')}`}
                  </span>
                </div>
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => void remove(c)}>
                  <Trash2 aria-hidden="true" />
                  {t('deleteButton')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  async function remove(c: CouponView) {
    if (!window.confirm(t('confirmDelete', { code: c.code }))) return;
    try {
      const res = await fetch(`/api/coupons/${c.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast({ variant: 'danger', title: t('toastDeleteFailed') });
        return;
      }
      toast({ variant: 'success', title: t('toastDeleted'), description: c.code });
      await reload();
    } catch {
      toast({ variant: 'danger', title: t('toastNetworkError') });
    }
  }
}
