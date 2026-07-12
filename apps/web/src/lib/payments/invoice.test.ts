import { describe, expect, it } from 'vitest';
import { makeInvoiceNumber, renderInvoiceHtml } from './invoice';

describe('invoice — rendu HTML (P54, étendu P148 conformité fiscale Maroc)', () => {
  it('génère un numéro de facture lisible et stable', () => {
    expect(makeInvoiceNumber('sc-pro-abc123-1720000000', new Date('2026-07-11'))).toBe(
      'SC-2026-1720000000',
    );
  });

  it('rend une facture sans détail fiscal (comportement historique inchangé)', () => {
    const html = renderInvoiceHtml({
      invoiceNumber: 'SC-2026-TEST01',
      plan: 'pro',
      price: { amountMinor: 2900, currency: 'EUR' },
      customerName: 'Jane Doe',
      customerEmail: 'jane@example.com',
      issuedAt: new Date('2026-07-11'),
    });
    expect(html).toContain('SC-2026-TEST01');
    expect(html).toContain('Jane Doe');
    // Pas de mention ICE/IF ni de ligne TVA séparée.
    expect(html).not.toContain('ICE :');
    expect(html).not.toContain('IF :');
  });

  it('rend une facture société marocaine avec ICE/IF et TVA détaillée', () => {
    const html = renderInvoiceHtml({
      invoiceNumber: 'SC-2026-TEST02',
      plan: 'business',
      price: { amountMinor: 99900, currency: 'MAD' },
      customerName: 'Salistar SARL',
      customerEmail: 'contact@salistar.ma',
      issuedAt: new Date('2026-07-11'),
      tax: {
        taxStatus: 'company',
        amountHTMinor: 83250,
        tvaRate: 0.2,
        amountTvaMinor: 16650,
        ice: '001234567000089',
        if: '12345678',
      },
    });
    expect(html).toContain('ICE : 001234567000089');
    expect(html).toContain('IF : 12345678');
    expect(html).toContain('TVA 20%');
    expect(html).toMatch(/TVA au taux normal de 20%/);
  });

  it('rend une facture auto-entrepreneur avec mention de franchise de TVA', () => {
    const html = renderInvoiceHtml({
      invoiceNumber: 'SC-2026-TEST03',
      plan: 'pro',
      price: { amountMinor: 29900, currency: 'MAD' },
      customerName: 'Amine Auto-Entrepreneur',
      customerEmail: 'amine@example.ma',
      issuedAt: new Date('2026-07-11'),
      tax: {
        taxStatus: 'auto_entrepreneur',
        amountHTMinor: 29900,
        tvaRate: 0,
        amountTvaMinor: 0,
      },
    });
    expect(html).toMatch(/TVA non applicable/);
    expect(html).toContain('TVA 0%');
    // Aucun ICE/IF renseigné pour cet auto-entrepreneur.
    expect(html).not.toContain('ICE :');
  });

  it('supporte la locale arabe (RTL)', () => {
    const html = renderInvoiceHtml({
      invoiceNumber: 'SC-2026-TEST04',
      plan: 'pro',
      price: { amountMinor: 2900, currency: 'EUR' },
      customerName: 'Test AR',
      customerEmail: 'test@example.com',
      locale: 'ar',
    });
    expect(html).toContain('dir="rtl"');
  });
});
