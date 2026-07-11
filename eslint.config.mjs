// @ts-check
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Flat config ESLint racine du monorepo SALLYCOURSE.
 *
 * Garde-fou principal : aucune couleur arbitraire Tailwind (`bg-[#...]`,
 * `text-[#...]`, etc.) en dehors de packages/design — la seule source de
 * vérité chromatique est packages/design/src/tokens.ts.
 */

/**
 * Motif esquery ciblant les classes Tailwind à couleur hex arbitraire.
 * Couvre bg-, text-, border-, from-, to- suivis de `[#`.
 */
const MOTIF_COULEUR_ARBITRAIRE = '(bg|text|border|from|to)-\\[#';

const MESSAGE_TOKENS_ONLY =
  'Couleur hex arbitraire interdite dans les classes Tailwind. ' +
  'Utilise les tokens du design system (bg-primary, text-accent-400, border-border, ...) ' +
  'définis dans packages/design/src/tokens.ts.';

export default tseslint.config(
  // Zones jamais lintées.
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.tsbuildinfo',
      '**/next-env.d.ts',
    ],
  },

  // Base TypeScript (sans type-checking pour rester rapide en CI/pre-commit).
  ...tseslint.configs.recommended,

  // Ajustements généraux TS/TSX.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      // Les underscores signalent volontairement un paramètre ignoré.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` explicite interdit : déjà recommandé par tseslint.configs.recommended
      // (niveau 'warn' par défaut) — on le durcit en 'error'. Les rares cas
      // légitimes (ex. apps/worker/src/lib/claude.ts, Input Zod volontairement
      // libre) sont neutralisés par un eslint-disable-next-line ciblé et justifié.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // NOTE dette technique / outillage non installé (Prompt 123) :
  // - `import/no-cycle` (détection de cycles d'imports) nécessite eslint-plugin-import,
  //   absent du lockfile. Signalé en depsNeeded — à ajouter puis activer ici une fois
  //   installé (scope: '**/*.{ts,tsx}', rules: { 'import/no-cycle': 'error' }).
  // - `react-hooks/exhaustive-deps` nécessite eslint-plugin-react-hooks, absent du
  //   lockfile (apps/web et apps/mobile utilisent des hooks React — ~46 fichiers
  //   concernés). Signalé en depsNeeded — à ajouter puis activer sur
  //   apps/web/**/*.tsx et apps/mobile/**/*.tsx une fois installé.

  // Garde-fou design : tokens uniquement dans les composants React.
  // packages/design est exempté : c'est là que vivent les hex de référence.
  {
    name: 'salistar/design-tokens-only',
    files: ['**/*.tsx'],
    ignores: ['packages/design/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Littéraux de chaîne : className="bg-[#5B2A86] ..."
          selector: `Literal[value=/${MOTIF_COULEUR_ARBITRAIRE}/]`,
          message: MESSAGE_TOKENS_ONLY,
        },
        {
          // Template literals : className={\`bg-[#5B2A86] ${...}\`}
          selector: `TemplateElement[value.raw=/${MOTIF_COULEUR_ARBITRAIRE}/]`,
          message: MESSAGE_TOKENS_ONLY,
        },
        {
          // Attributs JSX texte : couvre aussi les attributs non-className.
          selector: `JSXAttribute > Literal[value=/${MOTIF_COULEUR_ARBITRAIRE}/]`,
          message: MESSAGE_TOKENS_ONLY,
        },
      ],
    },
  },

  // Garde-fou fiabilité worker : les processors de queue (BullMQ) sont le
  // point d'entrée de tout job — une promesse lancée sans await ni .catch()
  // y fait disparaître silencieusement une erreur (job jamais marqué en échec,
  // jamais retenté). Règle activée seulement ici (nécessite le type-checking,
  // donc plus lente) pour ne pas ralentir le lint rapide du reste du monorepo.
  {
    name: 'salistar/worker-no-floating-promises',
    files: ['apps/worker/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './apps/worker/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  // Désactive les règles purement stylistiques : Prettier fait foi.
  prettier,
);
