#!/usr/bin/env node
// Lancement local one-command (cross-plateforme Windows/Linux/mac).
// Idempotent : relançable sans effet de bord.
//   - vérifie les prérequis (docker + docker compose)
//   - génère .env depuis .env.example avec des secrets locaux si absent
//   - démarre le profil `core` (web/worker/mongo/redis/minio)
//   - attend le healthcheck mongo
//   - exécute le seed (toléré si pas encore présent — cf. P185)
//   - affiche les URLs utiles

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_PATH = join(ROOT, '.env');
const ENV_EXAMPLE_PATH = join(ROOT, '.env.example');

// ── Petits helpers d'affichage ────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};
const ok = (m) => console.log(`${c.green}✓${c.reset} ${m}`);
const info = (m) => console.log(`${c.cyan}ℹ${c.reset} ${m}`);
const warn = (m) => console.log(`${c.yellow}!${c.reset} ${m}`);
const step = (m) => console.log(`\n${c.bold}${c.cyan}▶ ${m}${c.reset}`);
const fail = (m) => {
  console.error(`${c.red}✗ ${m}${c.reset}`);
  process.exit(1);
};

/** Exécute une commande en héritant du stdio ; retourne le code de sortie. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32', // nécessaire pour résoudre docker.exe sous Windows
    ...opts,
  });
  return res.status ?? 1;
}

/** Exécute une commande en capturant stdout (silencieux) ; retourne { code, out }. */
function capture(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { code: res.status ?? 1, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

// ── 1) Prérequis ──────────────────────────────────────────────────
function checkPrerequisites() {
  step('Vérification des prérequis');

  const docker = capture('docker', ['--version']);
  if (docker.code !== 0) {
    fail('Docker introuvable. Installez Docker Desktop : https://www.docker.com/products/docker-desktop/');
  }
  ok(`Docker détecté — ${docker.out}`);

  // `docker compose` (v2, plugin) requis
  const compose = capture('docker', ['compose', 'version']);
  if (compose.code !== 0) {
    fail(
      'Le plugin « docker compose » (v2) est introuvable. ' +
        'Mettez à jour Docker Desktop, ou installez le plugin compose.',
    );
  }
  ok(`docker compose détecté — ${compose.out.split('\n')[0]}`);

  // RAM disponible (indicatif)
  const totalGb = os.totalmem() / 1024 ** 3;
  const freeGb = os.freemem() / 1024 ** 3;
  if (totalGb < 6) {
    warn(`RAM totale ${totalGb.toFixed(1)} Go — la stack complète (FFmpeg/Chromium) préfère ≥ 8 Go.`);
  } else {
    ok(`RAM totale ${totalGb.toFixed(1)} Go (libre ~${freeGb.toFixed(1)} Go)`);
  }
}

// ── 2) Génération du .env ─────────────────────────────────────────
const hex = (bytes) => randomBytes(bytes).toString('hex');
const b64 = (bytes) => randomBytes(bytes).toString('base64');
/** Clé S3 locale alphanumérique lisible. */
const s3key = (bytes) => randomBytes(bytes).toString('base64url').replace(/[-_]/g, '').slice(0, bytes * 2);

/** Remplace « CLE=... » (valeur restante sur la ligne) par la valeur fournie. */
function setEnvVar(content, key, value) {
  const re = new RegExp(`^(${key})=.*$`, 'm');
  if (re.test(content)) return content.replace(re, `$1=${value}`);
  // Clé absente du template : on l'ajoute en fin de fichier.
  return content.replace(/\n*$/, `\n${key}=${value}\n`);
}

function ensureEnv() {
  step('Configuration (.env)');

  if (existsSync(ENV_PATH)) {
    ok('.env déjà présent — conservé tel quel (idempotent).');
    return;
  }
  if (!existsSync(ENV_EXAMPLE_PATH)) {
    fail('.env.example introuvable — impossible de générer .env.');
  }

  copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
  let content = readFileSync(ENV_PATH, 'utf8');

  // Secrets locaux générés à la volée.
  const s3Access = `local-${s3key(6)}`;
  const s3Secret = s3key(20);

  content = setEnvVar(content, 'AUTH_SECRET', b64(32)); // ≥ 16 car. requis par le schéma
  content = setEnvVar(content, 'CREDENTIALS_MASTER_KEY', hex(32)); // 64 hex requis
  content = setEnvVar(content, 'S3_ACCESS_KEY', s3Access);
  content = setEnvVar(content, 'S3_SECRET_KEY', s3Secret);

  writeFileSync(ENV_PATH, content);
  ok('.env généré depuis .env.example avec des secrets locaux (AUTH_SECRET, CREDENTIALS_MASTER_KEY, clés S3).');
  info('Renseignez ANTHROPIC_API_KEY / ELEVENLABS_API_KEY plus tard, ou mettez MOCK_PROVIDERS=true.');
}

// ── 3) Démarrage du profil core ───────────────────────────────────
function composeUp() {
  step('Démarrage des services (profil core)');
  const code = run('docker', ['compose', '--profile', 'core', 'up', '-d']);
  if (code !== 0) fail('Échec de « docker compose up ». Vérifiez que Docker est démarré.');
  ok('Conteneurs core lancés (web, worker, mongo, redis, minio).');
}

// ── 4) Attente du healthcheck mongo ───────────────────────────────
async function waitForMongo(timeoutMs = 120_000) {
  step('Attente du healthcheck MongoDB');
  const start = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Nom de conteneur : « <projet>-mongo-1 ». Le projet compose = « sallycourse ».
  while (Date.now() - start < timeoutMs) {
    // On interroge le status healthcheck via docker inspect (résout aussi le nom réel).
    const ps = capture('docker', [
      'compose',
      'ps',
      '--format',
      '{{.Name}} {{.Health}}',
      'mongo',
    ]);
    const line = ps.out.split('\n').find((l) => l.includes('mongo')) || '';
    if (/healthy/i.test(line)) {
      ok('MongoDB est « healthy ».');
      return;
    }
    process.stdout.write(`${c.dim}  …en attente (${Math.round((Date.now() - start) / 1000)}s)${c.reset}\r`);
    await sleep(3000);
  }
  console.log();
  fail('MongoDB n\'est pas devenu « healthy » dans le délai imparti. Inspectez : docker compose logs mongo');
}

// ── 5) Seed (toléré si absent) ────────────────────────────────────
function runSeed() {
  step('Seed de données de démonstration');
  // On tente d'abord un seed hors conteneur si un script pnpm existe (P185).
  const probe = capture('pnpm', ['--filter', '@sallycourse/worker', 'run']);
  const hasSeed = /(^|\s)seed(\s|$)/m.test(probe.out) || /(^|\s)seed(\s|$)/m.test(probe.err);

  if (!hasSeed) {
    warn('TODO(P185) : script « seed » du worker absent — étape ignorée (non bloquant).');
    return;
  }
  const code = run('pnpm', ['--filter', '@sallycourse/worker', 'seed']);
  if (code !== 0) {
    warn('Le seed a échoué (non bloquant). Relancez plus tard : pnpm seed');
    return;
  }
  ok('Seed exécuté.');
}

// ── 6) Récapitulatif URLs ─────────────────────────────────────────
function printSummary() {
  step('Prêt !');
  console.log(`${c.bold}Services locaux :${c.reset}`);
  console.log(`  ${c.green}Web (Next.js)${c.reset}     → http://localhost:3000`);
  console.log(`  ${c.green}MinIO console${c.reset}     → http://localhost:9001  (identifiants dans .env : S3_ACCESS_KEY / S3_SECRET_KEY)`);
  console.log(`  ${c.green}MinIO S3 API${c.reset}      → http://localhost:9000`);
  console.log(`  ${c.green}MongoDB${c.reset}           → mongodb://localhost:27017/sallycourse`);
  console.log(`  ${c.green}Redis${c.reset}             → redis://localhost:6379`);
  console.log();
  console.log(`${c.dim}Logs      : pnpm logs${c.reset}`);
  console.log(`${c.dim}Arrêt     : pnpm down${c.reset}`);
  console.log(`${c.dim}Full+IA   : pnpm up:full${c.reset}`);
}

// ── Orchestration ─────────────────────────────────────────────────
async function main() {
  console.log(`${c.bold}${c.cyan}SallyCourse — setup local one-command${c.reset}`);
  checkPrerequisites();
  ensureEnv();
  composeUp();
  await waitForMongo();
  runSeed();
  printSummary();
}

main().catch((e) => fail(e?.message || String(e)));
