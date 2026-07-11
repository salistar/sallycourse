import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 114 — Garde-fou "single source of truth" des types.
//
// Chaque entité majeure (Course, Notification, CostRecord…) doit avoir UNE
// SEULE interface Mongoose source dont dérivent les types utilisés ailleurs.
// Ce test grep packages/db/src/models/*.ts et échoue si un même nom
// d'interface EXPORTÉE (ex. "export interface INotification") est défini
// (pas juste importé/réexporté) dans plus d'un fichier de modèle.

const MODELS_DIR = join(__dirname, '.');

// Capture "export interface Foo" (avec ou sans generics avant le '{').
const EXPORTED_INTERFACE_RE = /^export interface (\w+)\b/gm;

function listModelFiles(): string[] {
  return readdirSync(MODELS_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts',
  );
}

function findExportedInterfaces(fileContent: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  EXPORTED_INTERFACE_RE.lastIndex = 0;
  while ((match = EXPORTED_INTERFACE_RE.exec(fileContent)) !== null) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

describe('single source of truth des interfaces de modèles (Prompt 114)', () => {
  it("n'a aucune interface exportée définie dans plus d'un fichier packages/db/src/models/*.ts", () => {
    const files = listModelFiles();
    expect(files.length).toBeGreaterThan(0);

    // interfaceName -> fichiers où elle est DÉFINIE (pas juste importée).
    const definedIn = new Map<string, string[]>();

    for (const file of files) {
      const content = readFileSync(join(MODELS_DIR, file), 'utf-8');
      for (const name of findExportedInterfaces(content)) {
        const list = definedIn.get(name) ?? [];
        list.push(file);
        definedIn.set(name, list);
      }
    }

    const duplicates = [...definedIn.entries()].filter(([, files]) => files.length > 1);

    if (duplicates.length > 0) {
      const details = duplicates
        .map(([name, files]) => `  - ${name} défini dans : ${files.join(', ')}`)
        .join('\n');
      throw new Error(
        `Interface(s) redéfinie(s) dans plusieurs fichiers (viole le single source of truth) :\n${details}`,
      );
    }

    expect(duplicates).toHaveLength(0);
  });
});
