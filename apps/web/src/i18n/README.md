# i18n — convention next-intl (SallyCourse web)

Infrastructure mise en place au Prompt 56. Approche **sans routing préfixé** :
la locale de l'UI est portée par le cookie `NEXT_LOCALE`, pas par l'URL. Les
pages restent à leur emplacement actuel (aucun `/[locale]` à créer).

## Pièces

- `src/i18n/routing.ts` — locales (`fr`/`en`/`ar`, réexport de `@sallycourse/shared`),
  `defaultLocale = 'fr'`, `LOCALE_COOKIE`, helpers `isRtlLocale` / `localeDirection` /
  `normalizeLocale`.
- `src/i18n/request.ts` — config de requête next-intl : lit le cookie, charge
  `messages/<locale>.json`. Référencée par le plugin dans `next.config.mjs`.
- `messages/{fr,en,ar}.json` — bundles de traductions, **structurés par domaine** :
  `common`, `nav`, `userMenu`, `plans`, `dashboard`, `create`, `course`, `auth`,
  `pricing`, `settings`.
- Root layout (`src/app/layout.tsx`) — `<html lang dir>` selon la locale +
  `NextIntlClientProvider` (messages exposés aux composants client).
- `src/components/i18n/language-switcher.tsx` — sélecteur de langue (cookie +
  reload), branché dans le menu utilisateur de la sidebar dashboard.

Le **contenu généré** (cours) suit `Course.locale` et reste indépendant de la
locale d'UI.

## Ajouter une clé de traduction

1. Choisir le **domaine** adéquat (`nav`, `dashboard`, `auth`…) ; créer un nouveau
   domaine seulement si aucun ne convient.
2. Ajouter la clé dans **les trois** fichiers `messages/fr.json`, `en.json`,
   `ar.json` (même chemin de clé partout). Ne jamais laisser une locale sans la
   clé — next-intl lève en dev sur clé manquante.
3. Consommer la clé :
   - **Composant serveur** : `import { getTranslations } from 'next-intl/server'`
     puis `const t = await getTranslations('nav'); t('dashboard')`.
   - **Composant client** : `import { useTranslations } from 'next-intl'` puis
     `const t = useTranslations('nav'); t('dashboard')`.
4. Interpolation : `t('welcome', { name })` avec la valeur `"welcome": "Bonjour {name}"`.

## Migration des textes en dur

La migration exhaustive des pages existantes est planifiée au **Prompt 113**.
Au Prompt 56, seules les clés des textes facilement identifiables (navigation,
menu utilisateur, plans, libellés d'auth) sont pré-remplies. Lors de l'ajout de
nouvelles pages, préférer directement `t(...)` plutôt qu'un texte en dur.
