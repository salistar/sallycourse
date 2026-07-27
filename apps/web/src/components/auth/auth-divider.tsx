import { useTranslations } from 'next-intl';

/** Séparateur « ou » entre la connexion par identifiants et l'OAuth. */
export function AuthDivider() {
  const t = useTranslations('auth.divider');
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={t('or')}>
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wider text-muted">{t('or')}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
