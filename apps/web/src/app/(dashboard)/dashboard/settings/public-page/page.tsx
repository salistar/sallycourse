import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connectDb, LmsListing as LmsListingModel, User as UserModel } from '@sallycourse/db';
import { suggestHandle } from '@sallycourse/shared/instructor';
import { requireUser } from '@/lib/session';
import { PublicPageManager } from './public-page-manager';

/**
 * Réglages → Page publique (Prompt 205) : choisir/valider son handle (@nom),
 * générer/régénérer sa bio publique, copier le lien de sa page instructeur.
 * Le handle est proposé depuis le nom à la première visite (suggestion PURE,
 * déterministe) — l'utilisateur reste libre de le modifier.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.publicPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

export default async function PublicPageSettings() {
  const user = await requireUser();
  const t = await getTranslations('settings.publicPage');

  await connectDb();
  const account = await UserModel.findById(user.id).select('name handle instructorBio').lean();
  const publishedCount = await LmsListingModel.countDocuments({
    userId: user.id,
    published: true,
  });

  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl text-muted">{t('description')}</p>
      </header>

      <PublicPageManager
        appUrl={appUrl}
        handle={account?.handle ?? null}
        // Proposition déterministe depuis le nom (jamais imposée) — l'id sert de
        // graine de repli quand le nom ne produit pas de handle exploitable.
        suggestedHandle={suggestHandle(account?.name ?? '', String(user.id))}
        hasPublishedCourse={publishedCount > 0}
        bio={
          account?.instructorBio
            ? {
                headline: account.instructorBio.headline,
                bio: account.instructorBio.bio,
                expertise: [...account.instructorBio.expertise],
                generatedAt: new Date(account.instructorBio.generatedAt).toISOString(),
              }
            : null
        }
      />
    </div>
  );
}
