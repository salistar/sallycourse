import { defineConfig } from 'vitest/config';

// Séparation nette des harnais de test :
//  - vitest  → fichiers *.test.ts (unitaires)
//  - Playwright → tests/**/*.spec.ts (régression visuelle D12, lancés via `playwright test`)
// Sans cette exclusion, vitest tenterait d'exécuter les specs Playwright et échouerait
// (test.describe() hors runner Playwright).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', 'tests/**', '.next/**'],
    environment: 'node',
  },
});
