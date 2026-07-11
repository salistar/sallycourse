import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';

/**
 * Gabarit du groupe (marketing) : en-tête + pied de page publics partagés
 * par la landing (/), /pricing, /showcase et /legal/*. Route group — n'affecte
 * pas les URLs (P95).
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
