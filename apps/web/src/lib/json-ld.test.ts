import { describe, expect, it } from 'vitest';
import { jsonLdHtml } from './json-ld';

describe('jsonLdHtml (échappement JSON-LD anti-XSS)', () => {
  it('neutralise une tentative de fermeture de balise <script>', () => {
    const out = jsonLdHtml({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<');
    expect(out).toContain('\\u003c');
  });

  it('échappe < > & (caractères significatifs en HTML)', () => {
    const out = jsonLdHtml({ v: '<b> & </b>' });
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    // Le & de la donnée est échappé ; aucun & littéral ne subsiste.
    expect(out).not.toContain('&');
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
    expect(out).toContain('\\u0026');
  });

  it('échappe les séparateurs de ligne U+2028 / U+2029 (interdits en script inline)', () => {
    const out = jsonLdHtml({ v: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(out).not.toContain(String.fromCharCode(0x2029));
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
  });

  it('préserve la sémantique JSON (round-trip identique à l’objet source)', () => {
    const data = { name: '</script>', title: 'A & B', nested: { list: ['<x>', 'y'] } };
    expect(JSON.parse(jsonLdHtml(data))).toEqual(data);
  });

  it('laisse intact un contenu sans caractère dangereux', () => {
    const data = { '@type': 'Person', name: 'Idriss', url: 'https://exemple.org/idriss' };
    expect(jsonLdHtml(data)).toBe(JSON.stringify(data));
  });
});
