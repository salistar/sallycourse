// lint-staged ne gère QUE l'eslint --fix par fichier stagé. Le typecheck
// monorepo (pnpm -r typecheck) est volontairement SORTI d'ici et exécuté une
// seule fois dans .husky/pre-commit, APRÈS lint-staged : lint-staged découpe
// en interne les listes de fichiers en lots (« chunking », dès qu'il y a
// beaucoup de fichiers stagés) et réinvoque CHAQUE commande une fois par lot
// — y compris une commande qui ignore la liste de fichiers comme
// `pnpm -r typecheck` (qui type-vérifie tout le monorepo, pas juste les
// fichiers stagés). Le garder ici causait plusieurs typechecks monorepo
// COMPLETS en parallèle à chaque commit, saturant CPU/IO et faisant échouer
// le hook (confirmé : 4 lots → 4 invocations concurrentes).
export default {
  '*.{ts,tsx,mts,cts}': (filenames) => `eslint --fix ${filenames.map((f) => `"${f}"`).join(' ')}`,
  '*.{js,jsx,mjs,cjs,json,md}': (filenames) => `eslint --fix ${filenames.map((f) => `"${f}"`).join(' ')}`,
};
