// Table de taux de change STATIQUE — Prompt 99 (tableau de bord revenus).
//
// Pourquoi statique : le dashboard revenus consolide des montants en
// MAD (CMI), EUR (Paddle/Lemon Squeezy) et USD (Gumroad, CourseAnalytics) en
// UNE devise d'affichage. Une vraie API forex (exchangerate.host, Open
// Exchange Rates…) introduirait un appel réseau externe dans un chemin
// dashboard/admin — hors du périmètre mock-friendly du projet et une
// dépendance de disponibilité non nécessaire pour un ordre de grandeur.
//
// Taux figés ici (référence 2026-07, à ajuster manuellement si besoin) :
// éditer UNIQUEMENT cette table pour changer la conversion partout.
//
// Pour brancher une vraie API forex plus tard : remplacer `FX_RATES` par un
// résultat mis en cache (Redis, TTL ~1h) d'un appel à un provider forex, en
// conservant cette table comme repli si l'appel échoue (voir `getRate` :
// signature déjà prête pour accepter une table injectée).

/** Devises supportées par le dashboard revenus. */
export const FX_CURRENCIES = ['MAD', 'EUR', 'USD'] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/**
 * Taux fixes vers 1 USD (« combien de devise pour 1 USD »). Cohérent avec
 * `toApproxUsd` (apps/web/src/lib/affiliate.ts) : EUR≈1.08 USD, MAD≈0.10 USD.
 * Ici on exprime l'inverse (unités de devise par USD) pour couvrir toutes les
 * paires via un pivot USD.
 */
export const FX_RATES_PER_USD: Record<FxCurrency, number> = {
  USD: 1,
  // 1 EUR ≈ 1.08 USD ⇒ 1 USD ≈ 0.9259 EUR.
  EUR: 1 / 1.08,
  // 1 MAD ≈ 0.10 USD ⇒ 1 USD ≈ 10 MAD.
  MAD: 10,
};

/** Date de référence des taux ci-dessus (documentation, pas utilisée en calcul). */
export const FX_RATES_AS_OF = '2026-07-01';

/**
 * Taux de conversion de `from` vers `to`, via pivot USD. 1 si devises égales.
 * Table injectable (`rates`) pour les tests / un futur repli API.
 */
export function getRate(
  from: FxCurrency,
  to: FxCurrency,
  rates: Record<FxCurrency, number> = FX_RATES_PER_USD,
): number {
  if (from === to) return 1;
  // montant_from → USD → to
  const toUsd = 1 / rates[from];
  return toUsd * rates[to];
}

/** Convertit un montant (unité majeure, ex. 29.90) de `from` vers `to`. */
export function convertAmount(
  amount: number,
  from: FxCurrency,
  to: FxCurrency,
  rates: Record<FxCurrency, number> = FX_RATES_PER_USD,
): number {
  if (from === to) return amount;
  const rate = getRate(from, to, rates);
  return Math.round(amount * rate * 100) / 100;
}
