#!/usr/bin/env node
import { run } from './index.js';

// Entrée exécutable : fournit les E/S réelles (process.env, console) et propage
// le code de sortie. Compilé en dist/bin.js (champ "bin" du package.json).

async function main(): Promise<void> {
  const code = await run(process.argv.slice(2), {
    env: process.env,
    log: (msg) => console.log(msg),
    error: (msg) => console.error(msg),
  });
  process.exitCode = code;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
