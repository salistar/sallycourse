// Config vitest du worker : réplique les paths du tsconfig (sources workspace
// consommées avec suffixe .js à la NodeNext) pour le résolveur de Vite.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (...segments: string[]): string => path.resolve(here, '../..', 'packages', ...segments);

export default defineConfig({
  resolve: {
    alias: [
      // Sous-chemins « .js » → sources .ts (pattern du pont src/shared.ts).
      { find: /^@sallycourse\/shared\/(.*)\.js$/, replacement: `${pkg('shared', 'src')}/$1.ts` },
      { find: /^@sallycourse\/db\/(.*)\.js$/, replacement: `${pkg('db', 'src')}/$1.ts` },
      { find: /^@sallycourse\/design\/(.*)\.js$/, replacement: `${pkg('design', 'src')}/$1.ts` },
      // Barils de packages.
      { find: '@sallycourse/shared', replacement: pkg('shared', 'src', 'index.ts') },
      { find: '@sallycourse/db', replacement: pkg('db', 'src', 'index.ts') },
      { find: '@sallycourse/design', replacement: pkg('design', 'src', 'index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
