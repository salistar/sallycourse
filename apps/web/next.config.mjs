import createNextIntlPlugin from 'next-intl/plugin';

// Plugin next-intl : pointe vers la config de requête (résolution de la locale
// via cookie + chargement des messages). Ajout additif — la config existante
// (transpilePackages, output) est préservée telle quelle.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sallycourse/shared', '@sallycourse/db', '@sallycourse/design'],
  output: 'standalone',
};

export default withNextIntl(nextConfig);
