import createNextIntlPlugin from 'next-intl/plugin';

// Plugin next-intl : pointe vers la config de requête (résolution de la locale
// via cookie + chargement des messages). Ajout additif — la config existante
// (transpilePackages, output) est préservée telle quelle.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sallycourse/shared', '@sallycourse/db', '@sallycourse/design'],
  output: 'standalone',
  webpack: (config) => {
    // Les packages workspace (@sallycourse/shared|db|design) utilisent la
    // convention NodeNext du worker : imports relatifs suffixés ".js" pointant
    // vers des sources .ts (ex. './templates.js' → './templates.ts'). webpack
    // ne résout pas ça nativement sous transpilePackages — extensionAlias est
    // la solution documentée par Next.js pour ce cas précis.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
