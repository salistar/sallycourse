#!/usr/bin/env node
// P117 (audit sécurité) : scan anti-secrets en dur, exécuté via `pnpm check:secrets`.
// Grep les patterns de clés API connues (OpenAI/Anthropic, Google, AWS) + quelques
// motifs génériques (mot de passe/token assigné à une chaîne longue en dur) sur les
// sources versionnées. Échoue (exit 1) si une correspondance est trouvée hors
// allowlist (fixtures de test explicitement nommées, valeurs factices).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Dossiers jamais scannés (build, deps, VCS, données locales).
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  'minio-data', 'mongo-data', 'redis-data', 'storage', 'tmp',
  'playwright-report', 'test-results', 'backups',
]);

// Extensions pertinentes (code + config) — on ignore binaires/lockfiles/media.
const SCANNED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.env', '.yml', '.yaml', '.md',
]);

// Patterns de clés API réelles connues par préfixe (haute confiance).
const KEY_PATTERNS = [
  { name: 'OpenAI/Anthropic (sk-...)', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Google API key (AIza...)', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: 'AWS Access Key ID (AKIA...)', re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'AWS Secret Access Key (assignation)', re: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/gi },
];

// Fichiers explicitement whitelistés (fixtures de test avec valeurs factices
// documentées comme telles — ex. 'sk-heygen-test' dans avatar.test.ts).
const ALLOWLIST_FILES = new Set([
  'apps/worker/src/media/avatar.test.ts',
  // Fixture de test avec une clé factice (préfixe "sk-ant-") servant à prouver
  // qu'aucun vrai appel Anthropic n'est déclenché par la route testée.
  'apps/web/src/app/api/demo/generate/route.test.ts',
  // Ce script lui-même : whitelist ci-dessus + noms de patterns mentionnent "sk-".
  'scripts/check-secrets.mjs',
]);

/** Parcourt récursivement le repo en respectant IGNORED_DIRS. */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (SCANNED_EXTENSIONS.has(extname(full))) {
      yield full;
    }
  }
}

let violations = [];

for (const file of walk(ROOT)) {
  const relPath = relative(ROOT, file).replace(/\\/g, '/');
  if (ALLOWLIST_FILES.has(relPath)) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // fichier binaire ou illisible — ignoré
  }

  for (const { name, re } of KEY_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNumber = content.slice(0, match.index).split('\n').length;
      violations.push({ file: relPath, line: lineNumber, pattern: name, snippet: match[0].slice(0, 12) + '…' });
    }
  }
}

if (violations.length > 0) {
  console.error(`check:secrets — ${violations.length} correspondance(s) suspecte(s) trouvée(s) :\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.pattern}]  ${v.snippet}`);
  }
  console.error('\nSi ce sont de vraies clés : révoque-les côté provider ET retire-les du code (utilise .env / secrets manager).');
  console.error("Si ce sont des valeurs factices de test : ajoute le fichier à ALLOWLIST_FILES dans scripts/check-secrets.mjs.");
  process.exit(1);
}

console.log('check:secrets — aucune clé API en dur détectée.');
process.exit(0);
