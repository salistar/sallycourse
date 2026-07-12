import { describe, expect, it } from 'vitest';
import {
  AUTO_ENTREPRENEUR_TVA_RATE,
  DEFAULT_MOROCCO_TVA_RATE,
  breakdownFromTTC,
  computeTaxBreakdown,
  isValidIce,
  isValidIf,
  legalMentionFor,
  requiresIceAndIf,
  toMoroccanAccountingCsv,
  tvaRateFor,
  type InvoiceCsvRow,
} from './moroccan-tax';

describe('moroccan-tax', () => {
  describe('tvaRateFor', () => {
    it('applique 0% pour un auto-entrepreneur (franchise de TVA)', () => {
      expect(tvaRateFor('auto_entrepreneur')).toBe(AUTO_ENTREPRENEUR_TVA_RATE);
    });

    it('applique le taux standard (20% par défaut) pour une société', () => {
      expect(tvaRateFor('company')).toBe(DEFAULT_MOROCCO_TVA_RATE);
    });

    it('applique le taux standard pour un statut non renseigné', () => {
      expect(tvaRateFor('unspecified')).toBe(DEFAULT_MOROCCO_TVA_RATE);
    });

    it('accepte un taux standard configurable', () => {
      expect(tvaRateFor('company', 0.1)).toBe(0.1);
      expect(tvaRateFor('auto_entrepreneur', 0.1)).toBe(0);
    });
  });

  describe('computeTaxBreakdown', () => {
    it('calcule TVA et TTC à partir du HT (taux 20%)', () => {
      const b = computeTaxBreakdown(29900, 0.2);
      expect(b).toEqual({ amountHT: 29900, tva: 0.2, amountTva: 5980, amountTTC: 35880 });
    });

    it('taux 0% (auto-entrepreneur) : TTC == HT', () => {
      const b = computeTaxBreakdown(29900, 0);
      expect(b).toEqual({ amountHT: 29900, tva: 0, amountTva: 0, amountTTC: 29900 });
    });

    it('arrondit la TVA au centime le plus proche', () => {
      // 999 * 0.2 = 199.8 → arrondi à 200
      const b = computeTaxBreakdown(999, 0.2);
      expect(b.amountTva).toBe(200);
      expect(b.amountTTC).toBe(1199);
    });

    it('rejette un montant HT négatif', () => {
      expect(() => computeTaxBreakdown(-1, 0.2)).toThrow();
    });

    it('rejette un taux hors [0,1]', () => {
      expect(() => computeTaxBreakdown(1000, 1.5)).toThrow();
      expect(() => computeTaxBreakdown(1000, -0.1)).toThrow();
    });
  });

  describe('breakdownFromTTC', () => {
    it('retro-calcule le HT à partir du TTC sans écart d’arrondi', () => {
      const b = breakdownFromTTC(35880, 0.2);
      expect(b.amountHT + b.amountTva).toBe(35880);
      expect(b.amountTTC).toBe(35880);
    });

    it('taux 0% : HT == TTC', () => {
      const b = breakdownFromTTC(29900, 0);
      expect(b).toEqual({ amountHT: 29900, tva: 0, amountTva: 0, amountTTC: 29900 });
    });

    it('rejette un montant TTC négatif', () => {
      expect(() => breakdownFromTTC(-1, 0.2)).toThrow();
    });
  });

  describe('mentions légales et exigences ICE/IF', () => {
    it('mentionne la franchise de TVA pour un auto-entrepreneur', () => {
      expect(legalMentionFor('auto_entrepreneur')).toMatch(/TVA non applicable/);
    });

    it('mentionne le taux normal pour une société', () => {
      expect(legalMentionFor('company')).toMatch(/20%/);
    });

    it('aucune mention pour un statut non renseigné', () => {
      expect(legalMentionFor('unspecified')).toBe('');
    });

    it('exige ICE+IF uniquement pour une société', () => {
      expect(requiresIceAndIf('company')).toBe(true);
      expect(requiresIceAndIf('auto_entrepreneur')).toBe(false);
      expect(requiresIceAndIf('unspecified')).toBe(false);
    });
  });

  describe('validation ICE/IF', () => {
    it('ICE valide : exactement 15 chiffres', () => {
      expect(isValidIce('001234567000089')).toBe(true);
      expect(isValidIce('12345')).toBe(false);
      expect(isValidIce('00123456700008A')).toBe(false);
    });

    it('IF valide : 6 à 8 chiffres', () => {
      expect(isValidIf('123456')).toBe(true);
      expect(isValidIf('12345678')).toBe(true);
      expect(isValidIf('12345')).toBe(false);
      expect(isValidIf('123456789')).toBe(false);
    });
  });

  describe('toMoroccanAccountingCsv', () => {
    const rows: InvoiceCsvRow[] = [
      {
        invoiceNumber: 'SC-2026-ABC123',
        issuedAt: new Date('2026-07-10T10:00:00Z'),
        ice: '001234567000089',
        if: '12345678',
        customerName: 'Salistar SARL',
        amountHT: 29900,
        tva: 0.2,
        amountTva: 5980,
        amountTTC: 35880,
        currency: 'MAD',
      },
      {
        invoiceNumber: 'SC-2026-XYZ999',
        issuedAt: new Date('2026-07-01T10:00:00Z'),
        ice: '',
        if: '',
        customerName: 'Auto-Entrepreneur, Test',
        amountHT: 9900,
        tva: 0,
        amountTva: 0,
        amountTTC: 9900,
        currency: 'EUR',
      },
    ];

    it('génère les colonnes standards marocaines', () => {
      const csv = toMoroccanAccountingCsv(rows);
      const lines = csv.split('\n');
      expect(lines[0]).toBe(
        'date,numero_facture,ice_client,if_client,client,montant_ht,taux_tva,montant_tva,montant_ttc,devise',
      );
    });

    it('trie les lignes par date croissante', () => {
      const csv = toMoroccanAccountingCsv(rows);
      const lines = csv.split('\n');
      expect(lines[1]).toContain('2026-07-01');
      expect(lines[2]).toContain('2026-07-10');
    });

    it('formate les montants en unité décimale (centimes → devise)', () => {
      const csv = toMoroccanAccountingCsv(rows);
      expect(csv).toContain('299.00');
      expect(csv).toContain('59.80');
      expect(csv).toContain('358.80');
    });

    it('échappe une raison sociale contenant une virgule', () => {
      const csv = toMoroccanAccountingCsv(rows);
      expect(csv).toContain('"Auto-Entrepreneur, Test"');
    });

    it('taux de TVA affiché en pourcentage entier', () => {
      const csv = toMoroccanAccountingCsv(rows);
      expect(csv).toContain('20%');
      expect(csv).toContain('0%');
    });

    it('CSV vide → seulement l’en-tête', () => {
      const csv = toMoroccanAccountingCsv([]);
      expect(csv.split('\n')).toHaveLength(1);
    });
  });
});
