import { parseArgs } from './args.js';
import { cmdCreate, cmdStatus, cmdDeploy, type Io } from './commands.js';
import { USAGE } from './help.js';

// Point d'entrée logique du CLI (testable) : dispatch de la commande vers son
// implémentation. `bin.ts` fournit les E/S réelles et le code de sortie process.

export type { Io } from './commands.js';

/** Flags booléens communs (ne consomment pas la valeur suivante). */
const BOOLEAN_FLAGS = ['json', 'help', 'h'];
const ALIASES = { h: 'help' };

/**
 * Exécute le CLI à partir des arguments bruts (sans node/script). Retourne le
 * code de sortie. Ne jette pas : les erreurs de config/exécution sont converties
 * en message + code 1.
 */
export async function run(argv: string[], io: Io): Promise<number> {
  const command = argv[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.log(USAGE);
    return command && command !== 'help' && command !== '--help' && command !== '-h' ? 1 : 0;
  }

  const rest = parseArgs(argv.slice(1), { booleanFlags: BOOLEAN_FLAGS, aliases: ALIASES });

  try {
    switch (command) {
      case 'create':
        return await cmdCreate(rest, io);
      case 'status':
        return await cmdStatus(rest, io);
      case 'deploy':
        return await cmdDeploy(rest, io);
      default:
        io.error(`Commande inconnue : ${command}. Voir "sallycourse help".`);
        return 1;
    }
  } catch (err) {
    // Erreurs de configuration/validation remontées par les commandes.
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
