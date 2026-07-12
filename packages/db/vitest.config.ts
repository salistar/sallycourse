// Config vitest de @sallycourse/db : résout les imports "@sallycourse/shared/*.js"
// (pont NodeNext du worker consommé en source, ex. packages/db/src/email/send.ts
// qui importe '@sallycourse/shared/config.js') vers les sources .ts réelles —
// même pattern que apps/worker/vitest.config.ts (le worker et packages/db
// partagent ce style d'import cross-package suffixé .js).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (...segments: string[]): string => path.resolve(here, '..', ...segments);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@sallycourse\/shared\/(.*)\.js$/, replacement: `${pkg('shared', 'src')}/$1.ts` },
      { find: /^@sallycourse\/shared\/([^.]+)$/, replacement: `${pkg('shared', 'src')}/$1.ts` },
      { find: '@sallycourse/shared', replacement: pkg('shared', 'src', 'index.ts') },
    ],
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
  },
});
