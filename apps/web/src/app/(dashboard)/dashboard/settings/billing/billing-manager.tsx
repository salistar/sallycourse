'use client';

import * as React from 'react';
import { Download, FileText, Receipt } from 'lucide-react';
import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Réglages → Facturation (Prompt 148, conformité fiscale Maroc) : statut
 * fiscal déclaré (auto-entrepreneur / société), ICE, IF, raison sociale — et
 * historique des factures émises avec export comptable CSV.
 */

const BILLING_ENDPOINT = '/api/account/billing';
const INVOICES_ENDPOINT = '/api/billing/invoices';
const EXPORT_ENDPOINT = '/api/billing/invoices/export';

type TaxStatus = 'auto_entrepreneur' | 'company' | 'unspecified';

interface BillingState {
  billingTaxStatus: TaxStatus;
  billingIce: string;
  billingIf: string;
  billingCompanyName: string;
  billingAddress: string;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  plan: string;
  amountHT: number;
  tva: number;
  amountTva: number;
  amountTTC: number;
  currency: 'MAD' | 'EUR';
  issuedAt: string;
  provider: string;
  taxStatus: TaxStatus;
}

const TAX_STATUS_LABELS: Record<TaxStatus, string> = {
  auto_entrepreneur: 'Auto-entrepreneur',
  company: 'Société',
  unspecified: 'Non renseigné',
};

/** Formate un montant en plus petite unité (centimes) vers l'affichage devise. */
function formatMinor(amountMinor: number, currency: 'MAD' | 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amountMinor / 100);
}

export function BillingManager() {
  const { toast } = useToast();
  const [billing, setBilling] = React.useState<BillingState>({
    billingTaxStatus: 'unspecified',
    billingIce: '',
    billingIf: '',
    billingCompanyName: '',
    billingAddress: '',
  });
  const [invoices, setInvoices] = React.useState<InvoiceRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [billingRes, invoicesRes] = await Promise.all([
          fetch(BILLING_ENDPOINT),
          fetch(INVOICES_ENDPOINT),
        ]);
        const billingData = (await billingRes.json().catch(() => null)) as { billing?: BillingState } | null;
        const invoicesData = (await invoicesRes.json().catch(() => null)) as { invoices?: InvoiceRow[] } | null;
        if (cancelled) return;
        if (billingData?.billing) setBilling(billingData.billing);
        if (invoicesData?.invoices) setInvoices(invoicesData.invoices);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isCompany = billing.billingTaxStatus === 'company';

  const onSave = React.useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(BILLING_ENDPOINT, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(billing),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({ title: 'Enregistrement impossible', description: data?.error, variant: 'danger' });
        return;
      }
      toast({ title: 'Réglages de facturation enregistrés', variant: 'success' });
    } catch {
      toast({ title: 'Erreur réseau', description: 'Serveur injoignable.', variant: 'danger' });
    } finally {
      setSaving(false);
    }
  }, [billing, toast]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="size-5 text-accent" aria-hidden="true" />
            Informations fiscales (Maroc)
          </CardTitle>
          <CardDescription>
            Renseignez votre statut fiscal pour recevoir des factures conformes. L’ICE et l’IF
            apparaissent sur chaque facture émise à partir de maintenant — les factures déjà émises
            ne sont pas modifiées rétroactivement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <fieldset disabled={loading} className="flex flex-col gap-5 disabled:opacity-50">
            <Select
              label="Statut fiscal"
              value={billing.billingTaxStatus}
              onChange={(e) =>
                setBilling((b) => ({ ...b, billingTaxStatus: e.target.value as TaxStatus }))
              }
            >
              <option value="unspecified">Non renseigné</option>
              <option value="auto_entrepreneur">Auto-entrepreneur</option>
              <option value="company">Société</option>
            </Select>

            <Input
              label="Raison sociale / nom facturé"
              value={billing.billingCompanyName}
              onChange={(e) => setBilling((b) => ({ ...b, billingCompanyName: e.target.value }))}
              maxLength={120}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={`ICE${isCompany ? ' (obligatoire)' : ''}`}
                value={billing.billingIce}
                onChange={(e) => setBilling((b) => ({ ...b, billingIce: e.target.value }))}
                placeholder="15 chiffres"
                maxLength={20}
                hint="Identifiant Commun de l'Entreprise"
              />
              <Input
                label={`IF${isCompany ? ' (obligatoire)' : ''}`}
                value={billing.billingIf}
                onChange={(e) => setBilling((b) => ({ ...b, billingIf: e.target.value }))}
                placeholder="6 à 8 chiffres"
                maxLength={20}
                hint="Identifiant Fiscal"
              />
            </div>

            <Input
              label="Adresse de facturation"
              value={billing.billingAddress}
              onChange={(e) => setBilling((b) => ({ ...b, billingAddress: e.target.value }))}
              maxLength={300}
            />

            <div>
              <Button loading={saving} onClick={() => void onSave()}>
                Enregistrer
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="size-5 text-accent" aria-hidden="true" />
              Historique des factures
            </CardTitle>
            {invoices.length > 0 && (
              <a
                href={EXPORT_ENDPOINT}
                download
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                <Download className="size-4" aria-hidden="true" />
                Export comptable (.csv)
              </a>
            )}
          </div>
          <CardDescription>
            Une facture est émise automatiquement à chaque paiement réussi. Cliquez sur une facture
            pour l’ouvrir au format imprimable (imprimer → PDF depuis votre navigateur).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted">Aucune facture pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs uppercase tracking-wide text-muted">
                    <th className="px-2 py-2 text-start">Facture</th>
                    <th className="px-2 py-2 text-start">Date</th>
                    <th className="px-2 py-2 text-start">Statut</th>
                    <th className="px-2 py-2 text-end">HT</th>
                    <th className="px-2 py-2 text-end">TVA</th>
                    <th className="px-2 py-2 text-end">TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60">
                      <td className="px-2 py-2">
                        <a
                          href={`/api/billing/invoices/${inv.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {inv.invoiceNumber}
                        </a>
                      </td>
                      <td className="px-2 py-2 text-muted">
                        {new Date(inv.issuedAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="draft">{TAX_STATUS_LABELS[inv.taxStatus]}</Badge>
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums">
                        {formatMinor(inv.amountHT, inv.currency)}
                      </td>
                      <td className="px-2 py-2 text-end tabular-nums">
                        {formatMinor(inv.amountTva, inv.currency)}
                      </td>
                      <td className="px-2 py-2 text-end font-medium tabular-nums">
                        {formatMinor(inv.amountTTC, inv.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
