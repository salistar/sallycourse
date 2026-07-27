'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { errorMessage } from '@/lib/error-message';

/**
 * « Acheter » un listing marketplace (P147) — la route purchase existait sans
 * aucun bouton (audit connectivité 2026-07-17). Achat = livraison d'une copie
 * indépendante du cours dans le compte de l'acheteur, puis redirection vers ce
 * nouveau cours. Non connecté → la route répond 401, on renvoie vers /login.
 */
export function BuyListingButton({ listingId, priceLabel }: { listingId: string; priceLabel: string }) {
  const router = useRouter();
  const tApiError = useTranslations('apiErrors');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const buy = async () => {
    if (!window.confirm(`Acheter ce cours (${priceLabel}) ? Une copie indépendante sera livrée dans votre compte.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/marketplace/${listingId}/purchase`, { method: 'POST' });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const data = (await res.json().catch(() => null)) as { courseId?: string; error?: string } | null;
      if (!res.ok) {
        setError(errorMessage(data, tApiError));
        return;
      }
      router.push(data?.courseId ? `/dashboard/courses/${data.courseId}` : '/dashboard');
    } catch {
      setError('Serveur injoignable.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="gold" size="sm" loading={busy} onClick={() => void buy()}>
        {!busy && <ShoppingCart aria-hidden="true" />}
        Acheter
      </Button>
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  );
}
