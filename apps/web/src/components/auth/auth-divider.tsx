/** Séparateur « ou » entre la connexion par identifiants et l'OAuth. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label="ou">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wider text-muted">ou</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
