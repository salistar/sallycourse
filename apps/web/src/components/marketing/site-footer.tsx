import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Github, Linkedin, Sparkles, Twitter } from 'lucide-react';

/**
 * Pied de page public (P95) — liens produit/entreprise/légal (P66) + réseaux.
 * Server component, contenu i18n via next-intl (namespace marketing.footer).
 */

const SOCIALS = [
  { href: 'https://twitter.com/sallycourse', label: 'Twitter', icon: Twitter },
  { href: 'https://linkedin.com/company/sallycourse', label: 'LinkedIn', icon: Linkedin },
  { href: 'https://github.com/sallycourse', label: 'GitHub', icon: Github },
] as const;

export async function SiteFooter() {
  const t = await getTranslations('marketing.footer');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-surface/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3 lg:col-span-1">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-b from-accent-300 to-accent-500 text-accent-foreground">
              <Sparkles className="size-3.5" aria-hidden="true" />
            </span>
            SallyCourse
          </Link>
          <p className="text-sm text-muted">{t('tagline')}</p>
          <div className="mt-2 flex items-center gap-3">
            {SOCIALS.map(({ href, label, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={label}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted transition-colors duration-fast hover:border-ring/50 hover:text-foreground"
              >
                <Icon className="size-3.5" aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('product')}</h3>
          <Link href="/#fonctionnalites" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.features')}
          </Link>
          <Link href="/pricing" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.pricing')}
          </Link>
          <Link href="/showcase" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.showcase')}
          </Link>
          <Link href="/blog" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.blog')}
          </Link>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('company')}</h3>
          <Link href="/login" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.login')}
          </Link>
          <Link href="/register" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.signup')}
          </Link>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('legal')}</h3>
          <Link href="/legal/cgu" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.cgu')}
          </Link>
          <Link href="/legal/cgv" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.cgv')}
          </Link>
          <Link href="/legal/confidentialite" className="text-sm text-foreground/80 transition-colors duration-fast hover:text-foreground">
            {t('links.privacy')}
          </Link>
        </div>
      </div>

      <div className="border-t border-border/60">
        <p className="mx-auto w-full max-w-6xl px-6 py-5 text-2xs text-muted">
          © {year} SallyCourse. {t('rights')}
        </p>
      </div>
    </footer>
  );
}
