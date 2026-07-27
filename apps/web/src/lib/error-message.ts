/**
 * Résout le message d'erreur LOCALISÉ d'une réponse API (i18n V5, §6.3).
 *
 * Le serveur renvoie `{ error: <message FR>, code? }`. Ce helper, côté client,
 * privilégie la traduction du `code` si elle existe, sinon retombe sur le
 * message FR brut du serveur, sinon sur un générique localisé. Tant qu'une
 * route n'émet pas encore de `code`, l'utilisateur voit le message FR d'origine
 * (zéro régression) — la migration des routes est incrémentale.
 *
 * `t` = translator next-intl scopé sur le namespace `apiErrors`
 * (`const t = useTranslations('apiErrors')`).
 */
export interface ApiErrorPayload {
  error?: string | null;
  code?: string | null;
  /** Valeurs d'interpolation ICU pour les messages d'erreur paramétrés. */
  params?: Record<string, string | number> | null;
}

/** Sous-ensemble du translator next-intl dont on a besoin ici. */
export interface ApiErrorTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

export function errorMessage(
  data: ApiErrorPayload | null | undefined,
  t: ApiErrorTranslator,
): string {
  const code = data?.code;
  if (code && t.has(code)) return t(code, data?.params ?? undefined);
  return data?.error ?? t('unknownError');
}
