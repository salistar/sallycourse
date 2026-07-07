import { createHash } from 'node:crypto';
import { getConfig } from '@sallycourse/shared';
import { priceFor, type PaidPlanId, type PlanPrice } from './plans';

/**
 * Passerelle CMI — Centre Monétique Interbancaire (Maroc). P54.
 *
 * CMI ne fournit pas de SDK : l'intégration est une redirection par formulaire
 * POST auto-soumis vers la page de paiement 3-D Secure, avec une signature
 * HMAC-less « hash v2 » (SHA-512, base64) sur l'ensemble des champs. Au retour,
 * CMI POST un callback signé de la même manière : on recalcule le hash et on
 * compare avant d'activer le plan.
 *
 * Ce module est PUR (aucune I/O) : génération des champs + signature + vérif.
 * Doc de référence : « CMI e-Commerce — Integration Guide », hashAlgorithm=ver3
 * (tri des clés, échappement \ et |, storeKey en dernier, SHA-512 → base64).
 */

/** Base de l'URL de la passerelle (sandbox par défaut ; prod via env plus tard). */
export const CMI_GATEWAY_URL = 'https://payment.cmi.co.ma/fim/est3Dgate';

/** Champs jamais inclus dans le calcul du hash (par spec CMI). */
const HASH_EXCLUDED = new Set(['hash', 'encoding']);

/**
 * Échappe une valeur pour la base signée : `\` → `\\` puis `|` → `\|`.
 * L'ordre importe (échapper l'antislash d'abord).
 */
export function escapeCmiValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Calcule le hash CMI (ver3) d'un jeu de paramètres :
 *  1. tri des clés par ordre alphabétique insensible à la casse ;
 *  2. exclusion de `hash` et `encoding` ;
 *  3. concaténation des valeurs échappées, séparées par `|` ;
 *  4. ajout de la storeKey (échappée) en dernier ;
 *  5. SHA-512 → base64.
 */
export function computeCmiHash(
  params: Record<string, string>,
  storeKey: string,
): string {
  const keys = Object.keys(params)
    .filter((k) => !HASH_EXCLUDED.has(k.toLowerCase()))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const parts = keys.map((k) => escapeCmiValue(params[k] ?? ''));
  parts.push(escapeCmiValue(storeKey));

  const plaintext = parts.join('|');
  return createHash('sha512').update(plaintext, 'utf8').digest('base64');
}

/**
 * Vérifie le hash d'un callback CMI en temps « comparaison de chaînes ». Le
 * champ `hash` reçu est retiré du calcul, puis on compare au hash recalculé.
 */
export function verifyCmiCallback(
  params: Record<string, string>,
  storeKey: string,
): boolean {
  const received = params.hash ?? params.HASH ?? '';
  if (!received) return false;
  const expected = computeCmiHash(params, storeKey);
  // Comparaison longueur-constante manuelle (base64, longueurs égales attendues).
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

export interface CmiFormParams {
  merchantId: string;
  storeKey: string;
  /** Montant décimal formaté (ex. « 299.00 ») — CMI attend un point décimal. */
  amount: string;
  currency: string;
  oid: string;
  okUrl: string;
  failUrl: string;
  callbackUrl: string;
  email: string;
  lang: string;
}

/** Code ISO 4217 numérique attendu par CMI (MAD = 504, EUR = 978). */
const CURRENCY_NUM: Record<string, string> = { MAD: '504', EUR: '978' };

/**
 * Construit les champs signés du formulaire de paiement CMI (hors bouton).
 * Retourne la table clé→valeur incluant `hash`, prête à être rendue en
 * <input hidden> d'un <form method="POST" action={CMI_GATEWAY_URL}>.
 */
export function buildCmiFormFields(p: CmiFormParams): Record<string, string> {
  const fields: Record<string, string> = {
    clientid: p.merchantId,
    oid: p.oid,
    amount: p.amount,
    currency: CURRENCY_NUM[p.currency] ?? p.currency,
    okUrl: p.okUrl,
    failUrl: p.failUrl,
    callbackUrl: p.callbackUrl,
    email: p.email,
    lang: p.lang,
    // 3-D Secure + auto-authentification côté CMI.
    storetype: '3D_PAY_HOSTING',
    trantype: 'PreAuth',
    rnd: Date.now().toString(),
    hashAlgorithm: 'ver3',
    encoding: 'UTF-8',
    // TranType/Instalment par défaut : paiement comptant.
  };
  fields.hash = computeCmiHash(fields, p.storeKey);
  return fields;
}

/** Référence de commande unique et lisible : `sc_<plan>_<userId>_<ts>`. */
export function makeOrderId(userId: string, plan: PaidPlanId): string {
  return `sc-${plan}-${userId}-${Date.now()}`;
}

/**
 * Extrait plan + userId d'un oid généré par makeOrderId. Retourne null si le
 * format ne correspond pas (callback forgé/altéré).
 */
export function parseOrderId(
  oid: string,
): { plan: PaidPlanId; userId: string } | null {
  const m = /^sc-(pro|business)-([0-9a-fA-F]{24})-\d+$/.exec(oid);
  if (!m) return null;
  // Les groupes 1 et 2 sont garantis présents par le match ci-dessus.
  return { plan: m[1] as PaidPlanId, userId: m[2] as string };
}

export interface CmiConfig {
  merchantId: string;
  storeKey: string;
}

/** Vraie config CMI si les deux clés sont présentes, sinon null (mode mock). */
export function getCmiConfig(): CmiConfig | null {
  const cfg = getConfig();
  if (cfg.CMI_MERCHANT_ID && cfg.CMI_STORE_KEY) {
    return { merchantId: cfg.CMI_MERCHANT_ID, storeKey: cfg.CMI_STORE_KEY };
  }
  return null;
}

/** Montant décimal CMI (« 299.00 ») à partir d'un PlanPrice en unité mineure. */
export function cmiAmount(price: PlanPrice): string {
  return (price.amountMinor / 100).toFixed(2);
}

/**
 * Prépare le paiement CMI d'un plan en MAD : renvoie les champs de formulaire
 * signés et l'URL de la passerelle, ou null si le plan/tarif est inconnu.
 * L'appelant (route handler) fournit les URLs de retour et l'email.
 */
export function prepareCmiCheckout(args: {
  cfg: CmiConfig;
  userId: string;
  plan: PaidPlanId;
  email: string;
  okUrl: string;
  failUrl: string;
  callbackUrl: string;
  lang?: string;
}): { action: string; fields: Record<string, string>; oid: string } | null {
  const price = priceFor(args.plan, 'MAD');
  if (!price) return null;

  const oid = makeOrderId(args.userId, args.plan);
  const fields = buildCmiFormFields({
    merchantId: args.cfg.merchantId,
    storeKey: args.cfg.storeKey,
    amount: cmiAmount(price),
    currency: 'MAD',
    oid,
    okUrl: args.okUrl,
    failUrl: args.failUrl,
    callbackUrl: args.callbackUrl,
    email: args.email,
    lang: args.lang ?? 'fr',
  });
  return { action: CMI_GATEWAY_URL, fields, oid };
}

/** Statuts CMI de succès (callback ProcReturnCode / Response). */
export function isCmiApproved(params: Record<string, string>): boolean {
  const code = params.ProcReturnCode ?? params.procreturncode ?? '';
  const response = (params.Response ?? params.response ?? '').toLowerCase();
  return code === '00' || response === 'approved';
}
