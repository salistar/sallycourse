import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Séparation nette des harnais de test :
//  - vitest  → fichiers *.test.ts (unitaires)
//  - Playwright → tests/**/*.spec.ts (régression visuelle D12, lancés via `playwright test`)
// Sans cette exclusion, vitest tenterait d'exécuter les specs Playwright et échouerait
// (test.describe() hors runner Playwright).

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (...segments: string[]): string => path.resolve(here, '../..', 'packages', ...segments);

export default defineConfig({
  resolve: {
    alias: [
      // Réplique le pattern de apps/worker/vitest.config.ts : les sources
      // workspace sont consommées avec suffixe « .js » (convention NodeNext) —
      // Vite doit les réécrire vers les .ts réels pour les résoudre.
      { find: /^@sallycourse\/shared\/(.*)\.js$/, replacement: `${pkg('shared', 'src')}/$1.ts` },
      { find: /^@sallycourse\/db\/(.*)\.js$/, replacement: `${pkg('db', 'src')}/$1.ts` },
      { find: /^@sallycourse\/design\/(.*)\.js$/, replacement: `${pkg('design', 'src')}/$1.ts` },
      { find: /^@sallycourse\/shared\/([^.]+)$/, replacement: `${pkg('shared', 'src')}/$1.ts` },
      { find: /^@sallycourse\/db\/([^.]+)$/, replacement: `${pkg('db', 'src')}/$1.ts` },
      { find: /^@sallycourse\/design\/([^.]+)$/, replacement: `${pkg('design', 'src')}/$1.ts` },
      { find: '@sallycourse/shared', replacement: pkg('shared', 'src', 'index.ts') },
      { find: '@sallycourse/db', replacement: pkg('db', 'src', 'index.ts') },
      { find: '@sallycourse/design', replacement: pkg('design', 'src', 'index.ts') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'tests/**', '.next/**'],
    environment: 'node',
  },
});
