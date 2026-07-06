/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@sallycourse/shared', '@sallycourse/db', '@sallycourse/design'],
  output: 'standalone',
};

export default nextConfig;
