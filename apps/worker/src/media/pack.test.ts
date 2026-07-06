// Tests des helpers purs du packaging (Prompt 30) : slug, nommage ordonné,
// CSV Udemy bulk, conversion Markdown → HTML.
import { describe, expect, it } from 'vitest';
import type { QuizQuestion } from '../shared.js';
import {
  UDEMY_QUIZ_CSV_HEADER,
  markdownToHtml,
  orderedName,
  paddedOrder,
  quizToUdemyCsv,
  renderInline,
  slugify,
} from './pack.js';

describe('slugify', () => {
  it('normalise accents, casse et séparateurs', () => {
    expect(slugify('Créer une API REST !')).toBe('creer-une-api-rest');
    expect(slugify('  Multiple   espaces  ')).toBe('multiple-espaces');
    expect(slugify('C# & .NET')).toBe('c-net');
  });

  it('replie sur « item » quand le résultat est vide', () => {
    expect(slugify('!!!')).toBe('item');
    expect(slugify('')).toBe('item');
  });
});

describe('paddedOrder / orderedName', () => {
  it('padde l’ordre base 0 sur deux chiffres (1-based)', () => {
    expect(paddedOrder(0)).toBe('01');
    expect(paddedOrder(9)).toBe('10');
    expect(paddedOrder(11)).toBe('12');
  });

  it('compose NN-slug', () => {
    expect(orderedName(0, 'Introduction générale')).toBe('01-introduction-generale');
    expect(orderedName(2, 'Les Bases')).toBe('03-les-bases');
  });
});

describe('quizToUdemyCsv', () => {
  const q = (over: Partial<QuizQuestion>): QuizQuestion => ({
    question: 'Question ?',
    choices: ['A', 'B', 'C', 'D'],
    correctIndex: 0,
    explanation: '',
    difficulty: 'beginner',
    ...over,
  });

  it('émet l’en-tête puis une ligne par question, réponse 1-based', () => {
    const csv = quizToUdemyCsv([q({ correctIndex: 2 })]);
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe(UDEMY_QUIZ_CSV_HEADER.join(','));
    // correctIndex 2 → « Correct Response » = 3.
    expect(rows[1]).toBe('Question ?,A,B,C,D,3,');
  });

  it('échappe les cellules contenant virgules, guillemets et retours', () => {
    const csv = quizToUdemyCsv([
      q({ question: 'A, B ou "C" ?', explanation: 'Ligne 1\nLigne 2' }),
    ]);
    const line = csv.split('\r\n')[1]!;
    expect(line).toContain('"A, B ou ""C"" ?"');
    expect(line).toContain('"Ligne 1\nLigne 2"');
  });

  it('ignore les questions n’ayant pas exactement 4 propositions', () => {
    const csv = quizToUdemyCsv([q({ choices: ['A', 'B'] }), q({})]);
    expect(csv.split('\r\n')).toHaveLength(2); // en-tête + 1 question valide
  });
});

describe('renderInline', () => {
  it('échappe le HTML brut', () => {
    expect(renderInline('a < b & c')).toBe('a &lt; b &amp; c');
  });

  it('rend gras, italique et code inline', () => {
    expect(renderInline('**gras**')).toBe('<strong>gras</strong>');
    expect(renderInline('texte *ital*')).toBe('texte <em>ital</em>');
    expect(renderInline('appelle `fn()`')).toBe('appelle <code>fn()</code>');
  });

  it('ne réinterprète pas le contenu d’un code inline', () => {
    expect(renderInline('`**pas gras**`')).toBe('<code>**pas gras**</code>');
  });
});

describe('markdownToHtml', () => {
  it('convertit titres et paragraphes', () => {
    const html = markdownToHtml('# Titre\n\nUn paragraphe.');
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<p>Un paragraphe.</p>');
  });

  it('convertit les blocs de code sans les échapper deux fois', () => {
    const html = markdownToHtml('```js\nconst x = 1 < 2;\n```');
    expect(html).toContain('<pre><code class="language-js">const x = 1 &lt; 2;</code></pre>');
  });

  it('regroupe les listes à puces et numérotées', () => {
    const ul = markdownToHtml('- un\n- deux');
    expect(ul).toBe('<ul>\n<li>un</li>\n<li>deux</li>\n</ul>');
    const ol = markdownToHtml('1. un\n2. deux');
    expect(ol).toBe('<ol>\n<li>un</li>\n<li>deux</li>\n</ol>');
  });

  it('rend les citations', () => {
    expect(markdownToHtml('> À retenir')).toBe('<blockquote>À retenir</blockquote>');
  });
});
