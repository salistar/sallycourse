import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { locales } from './routing';

/**
 * Parité des catalogues de traduction : fr/en/ar DOIVENT exposer exactement le
 * même ensemble de clés (à plat) et les mêmes variables d'interpolation par
 * message. Rien ne l'imposait jusqu'ici — une clé ajoutée dans un seul fichier
 * cassait silencieusement une langue. Ce test est le garde-fou de tout le
 * chantier i18n (fr = source de vérité).
 */

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'messages');

type Json = { [k: string]: unknown };

function load(locale: string): Json {
  return JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf-8')) as Json;
}

/** Chemins de toutes les feuilles (valeurs primitives), ex. "nav.dashboard" ou
 *  "marketing.faq.items.0.q" — on descend AUSSI dans les tableaux (par index),
 *  pour que la parité couvre aussi le nombre d'éléments des listes traduites. */
function leafKeys(obj: unknown, prefix = ''): string[] {
  const out: string[] = [];
  const entries: [string, unknown][] = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v])
    : Object.entries(obj as Json);
  for (const [k, v] of entries) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...leafKeys(v, path));
    else out.push(path);
  }
  return out.sort();
}

/** Valeur d'une clé pointée (a.b.c). */
function at(obj: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => (acc as Json | undefined)?.[part], obj);
}

/** Variables ICU {name} référencées par un message. On retire d'abord les
 *  branches de pluriel/select (ex. `one {step}`) : leur texte n'est pas une
 *  variable, et il est ASCII en anglais mais accentué/non-latin ailleurs, ce
 *  qui créait de faux écarts. */
function icuVars(message: string): string[] {
  let m = message;
  let prev: string;
  do {
    prev = m;
    m = m.replace(/\b(?:zero|one|two|few|many|other|=\d+)\s*\{[^{}]*\}/g, ' ');
  } while (m !== prev);
  const set = new Set<string>();
  for (const mm of m.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[},]/g)) set.add(mm[1]!);
  return [...set].sort();
}

const catalogs = Object.fromEntries(locales.map((l) => [l, load(l)])) as Record<string, Json>;
const referenceLocale = 'fr';
const referenceKeys = leafKeys(catalogs[referenceLocale]!);

describe('parité des catalogues i18n', () => {
  it('fr expose au moins les namespaces attendus', () => {
    expect(referenceKeys.length).toBeGreaterThan(200);
  });

  for (const locale of locales) {
    if (locale === referenceLocale) continue;

    it(`${locale} a exactement les mêmes clés que ${referenceLocale}`, () => {
      const keys = leafKeys(catalogs[locale]!);
      const missing = referenceKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !referenceKeys.includes(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it(`${locale} n'a aucune valeur manquante ou chaîne vide`, () => {
      // Les feuilles sont surtout des strings, parfois des nombres (ex. note
      // d'avis) : on interdit seulement l'absence ou la chaîne blanche.
      const empties = referenceKeys.filter((k) => {
        const v = at(catalogs[locale]!, k);
        return v == null || (typeof v === 'string' && v.trim() === '');
      });
      expect(empties).toEqual([]);
    });

    it(`${locale} conserve les mêmes variables d'interpolation que ${referenceLocale}`, () => {
      const mismatches = referenceKeys
        .map((k) => {
          const ref = at(catalogs[referenceLocale]!, k);
          const loc = at(catalogs[locale]!, k);
          if (typeof ref !== 'string' || typeof loc !== 'string') return null;
          const rv = icuVars(ref);
          const lv = icuVars(loc);
          return rv.join(',') === lv.join(',') ? null : { key: k, [referenceLocale]: rv, [locale]: lv };
        })
        .filter(Boolean);
      expect(mismatches).toEqual([]);
    });
  }
});
