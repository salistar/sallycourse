import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  computeCmiHash,
  verifyCmiCallback,
  escapeCmiValue,
  buildCmiFormFields,
  makeOrderId,
  parseOrderId,
  isCmiApproved,
} from './cmi';

describe('CMI — signature ver3', () => {
  const storeKey = 'SECRET_STORE_KEY_123';

  it('échappe \\ et | dans le bon ordre', () => {
    expect(escapeCmiValue('a|b')).toBe('a\\|b');
    expect(escapeCmiValue('a\\b')).toBe('a\\\\b');
    // Antislash échappé d'abord : « \| » ne doit pas devenir « \\| » puis re-cassé.
    expect(escapeCmiValue('a\\|b')).toBe('a\\\\\\|b');
  });

  it('calcule un hash reproductible, indépendant de l’ordre des clés', () => {
    const a = { clientid: '600', oid: 'sc-pro-x', amount: '299.00' };
    const b = { amount: '299.00', oid: 'sc-pro-x', clientid: '600' };
    expect(computeCmiHash(a, storeKey)).toBe(computeCmiHash(b, storeKey));
  });

  it('exclut hash et encoding du calcul', () => {
    const base = { clientid: '600', oid: 'x' };
    const withExtra = { clientid: '600', oid: 'x', hash: 'zzz', encoding: 'UTF-8' };
    expect(computeCmiHash(withExtra, storeKey)).toBe(computeCmiHash(base, storeKey));
  });

  it('correspond à un calcul de référence (tri insensible à la casse + storeKey en fin)', () => {
    const params = { Bmount: '10.00', amount: '299.00', oid: 'sc-pro-1' };
    // Ordre attendu (casse ignorée) : amount, Bmount, oid, puis storeKey.
    const plaintext = ['299.00', '10.00', 'sc-pro-1', storeKey].join('|');
    const expected = createHash('sha512').update(plaintext, 'utf8').digest('base64');
    expect(computeCmiHash(params, storeKey)).toBe(expected);
  });

  it('vérifie un callback signé et rejette une altération', () => {
    const params: Record<string, string> = { clientid: '600', oid: 'sc-pro-1', amount: '299.00' };
    params.hash = computeCmiHash(params, storeKey);
    expect(verifyCmiCallback(params, storeKey)).toBe(true);

    // Montant falsifié après signature → rejet.
    const tampered = { ...params, amount: '1.00' };
    expect(verifyCmiCallback(tampered, storeKey)).toBe(false);

    // Mauvaise storeKey → rejet.
    expect(verifyCmiCallback(params, 'WRONG')).toBe(false);

    // Hash absent → rejet.
    const { hash: _omit, ...noHash } = params;
    void _omit;
    expect(verifyCmiCallback(noHash, storeKey)).toBe(false);
  });

  it('inclut un hash valide dans les champs du formulaire', () => {
    const fields = buildCmiFormFields({
      merchantId: '600001',
      storeKey,
      amount: '299.00',
      currency: 'MAD',
      oid: 'sc-pro-abc',
      okUrl: 'https://app/ok',
      failUrl: 'https://app/fail',
      callbackUrl: 'https://app/cb',
      email: 'user@example.com',
      lang: 'fr',
    });
    expect(fields.currency).toBe('504'); // MAD → code numérique ISO
    expect(fields.storetype).toBe('3D_PAY_HOSTING');
    expect(fields.hash).toBeTruthy();
    // Le hash des champs (sans lui-même) doit se re-vérifier.
    expect(verifyCmiCallback(fields, storeKey)).toBe(true);
  });
});

describe('CMI — oid & statut', () => {
  it('génère et re-parse un oid (plan + userId 24-hex)', () => {
    const userId = 'a'.repeat(24);
    const oid = makeOrderId(userId, 'business');
    const parsed = parseOrderId(oid);
    expect(parsed).toEqual({ plan: 'business', userId });
  });

  it('rejette un oid malformé', () => {
    expect(parseOrderId('garbage')).toBeNull();
    expect(parseOrderId('sc-free-' + 'a'.repeat(24) + '-1')).toBeNull(); // free non payant
    expect(parseOrderId('sc-pro-shortid-1')).toBeNull();
  });

  it('reconnaît l’approbation via ProcReturnCode ou Response', () => {
    expect(isCmiApproved({ ProcReturnCode: '00' })).toBe(true);
    expect(isCmiApproved({ Response: 'Approved' })).toBe(true);
    expect(isCmiApproved({ ProcReturnCode: '05', Response: 'Declined' })).toBe(false);
    expect(isCmiApproved({})).toBe(false);
  });
});
