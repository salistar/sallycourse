// Parsing d'arguments maison — aucune dépendance externe.
// Sépare les positionnels des options (--flag value, --flag=value, --bool).

export interface ParsedArgs {
  /** Arguments positionnels dans l'ordre (hors options). */
  positionals: string[];
  /** Options nommées : valeur string, ou true pour un flag booléen. */
  options: Record<string, string | boolean>;
}

/**
 * Découpe une liste d'arguments bruts (argv sans node/script) en positionnels
 * et options. Reconnaît `--flag=valeur`, `--flag valeur`, `--flag` (booléen si
 * suivi d'une autre option ou de rien), et les alias courts `-x`.
 *
 * Un flag connu comme booléen (dans `booleanFlags`) ne consomme jamais la valeur
 * suivante ; sinon un `--flag` suivi d'un token non-option consomme ce token.
 */
export function parseArgs(
  argv: string[],
  options: { booleanFlags?: string[]; aliases?: Record<string, string> } = {},
): ParsedArgs {
  const booleanFlags = new Set(options.booleanFlags ?? []);
  const aliases = options.aliases ?? {};
  const positionals: string[] = [];
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === '--') {
      // Tout ce qui suit est positionnel.
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        parsed[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const name = body;
      if (booleanFlags.has(name)) {
        parsed[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        parsed[name] = next;
        i++;
      } else {
        parsed[name] = true;
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const short = token.slice(1);
      const name = aliases[short] ?? short;
      if (booleanFlags.has(name)) {
        parsed[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        parsed[name] = next;
        i++;
      } else {
        parsed[name] = true;
      }
      continue;
    }

    positionals.push(token);
  }

  return { positionals, options: parsed };
}

/** Lit une option comme string, ou undefined si absente/booléenne. */
export function optString(
  args: ParsedArgs,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = args.options[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/** Vrai si un des flags booléens est présent. */
export function optBool(args: ParsedArgs, ...names: string[]): boolean {
  return names.some((name) => args.options[name] === true || args.options[name] === 'true');
}

/** Découpe une valeur CSV (ex. "udemy,youtube") en liste nettoyée. */
export function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
