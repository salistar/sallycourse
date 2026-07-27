/**
 * Sérialisation SÛRE d'un objet JSON-LD pour injection dans un
 * `<script type="application/ld+json" dangerouslySetInnerHTML>`.
 *
 * `JSON.stringify` seul n'échappe NI `<` NI `/` : une valeur contenant
 * « </script> » (nom d'instructeur, titre de cours, texte généré par LLM…)
 * referme la balise et permet une injection de script (stored XSS). On neutralise
 * les caractères significatifs en HTML par leur échappement Unicode — la valeur
 * JSON reste sémantiquement identique mais ne peut plus casser la balise. U+2028
 * et U+2029 (séparateurs de ligne interdits dans un script inline) sont aussi
 * échappés.
 *
 * Les code points U+2028/U+2029 sont dérivés via String.fromCharCode plutôt
 * qu'écrits littéralement : un caractère brut dans un littéral de regex/chaîne
 * source casserait le parsing JS. PURE.
 */
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

const JSON_LD_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  [LINE_SEP]: '\\u2028',
  [PARA_SEP]: '\\u2029',
};

const JSON_LD_UNSAFE = new RegExp(`[<>&${LINE_SEP}${PARA_SEP}]`, 'g');

export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(JSON_LD_UNSAFE, (ch) => JSON_LD_ESCAPES[ch] ?? ch);
}
