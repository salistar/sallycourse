import { describe, expect, it } from 'vitest';
import {
  BLOG,
  assembleBlogMarkdown,
  blogFaqJsonLd,
  blogPlanSchema,
  blogPostContentSchema,
  blogPostStatusFor,
  blogPostingJsonLd,
  blogSlugify,
  computeBlogSchedule,
  computeInternalLinks,
  countBlogWords,
  countKeywordOccurrences,
  renderCourseCta,
  renderInternalLinksSection,
  selectDueBlogPosts,
  uniqueBlogSlug,
  validateBlogSeo,
  type BlogPostContent,
} from './blog';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Corps conforme : 4 H2, mot-clé répété, longueur suffisante. */
function validBody(keyword: string, words = BLOG.MIN_WORDS + 50): string {
  const filler = Array.from({ length: words }, () => 'mot').join(' ');
  return [
    `## Pourquoi ${keyword} change la donne`,
    filler,
    `## Comment débuter avec ${keyword}`,
    'Contenu concret.',
    `## Les erreurs fréquentes autour de ${keyword}`,
    'Contenu concret.',
    '## FAQ',
    'Contenu concret.',
  ].join('\n\n');
}

function validPost(keyword = 'tests automatisés', overrides: Partial<BlogPostContent> = {}): BlogPostContent {
  return {
    title: `Guide complet des ${keyword} en 2026`,
    metaDescription:
      'Découvrez comment structurer votre stratégie et progresser rapidement grâce à un guide clair, concret et actionnable.',
    markdown: validBody(keyword),
    faq: [
      { question: 'Combien de temps faut-il ?', answer: 'Quelques semaines suffisent avec de la régularité.' },
      { question: 'Faut-il des prérequis ?', answer: 'Aucun prérequis technique particulier.' },
    ],
    ...overrides,
  };
}

describe('blogSlugify / uniqueBlogSlug', () => {
  it('produit un slug ASCII sans accents ni ponctuation', () => {
    expect(blogSlugify('Déployer Kubernetes : le guide (2026) !')).toBe('deployer-kubernetes-le-guide-2026');
  });

  it('retombe sur « article » pour un titre sans caractère exploitable', () => {
    expect(blogSlugify('!!! ???')).toBe('article');
  });

  it('suffixe le slug tant qu’il est déjà pris', () => {
    const taken = ['guide-react', 'guide-react-2'];
    expect(uniqueBlogSlug('Guide React', taken)).toBe('guide-react-3');
  });

  it('laisse le slug intact s’il est libre', () => {
    expect(uniqueBlogSlug('Guide React', [])).toBe('guide-react');
  });
});

describe('computeBlogSchedule', () => {
  const publishedAt = new Date('2026-01-01T10:00:00.000Z');

  it('publie le 1er article immédiatement puis un par cadence', () => {
    const dates = computeBlogSchedule(publishedAt, 6, 7);
    expect(dates).toHaveLength(6);
    expect(dates[0]!.toISOString()).toBe(publishedAt.toISOString());
    expect(dates[1]!.getTime() - publishedAt.getTime()).toBe(7 * DAY_MS);
    expect(dates[5]!.getTime() - publishedAt.getTime()).toBe(35 * DAY_MS);
  });

  it('utilise les défauts (6 articles, 7 jours) quand la cadence est omise', () => {
    const dates = computeBlogSchedule(publishedAt, BLOG.DEFAULT_POSTS_PER_COURSE);
    expect(dates).toHaveLength(BLOG.DEFAULT_POSTS_PER_COURSE);
    expect(dates[1]!.getTime() - dates[0]!.getTime()).toBe(BLOG.DEFAULT_CADENCE_DAYS * DAY_MS);
  });

  it('ne dérive pas : chaque date est dérivée de la publication du cours', () => {
    const dates = computeBlogSchedule(publishedAt, 3, 10);
    for (const [index, date] of dates.entries()) {
      expect(date.getTime()).toBe(publishedAt.getTime() + index * 10 * DAY_MS);
    }
  });

  it('retourne un tableau vide pour un compte nul ou négatif', () => {
    expect(computeBlogSchedule(publishedAt, 0)).toEqual([]);
    expect(computeBlogSchedule(publishedAt, -3)).toEqual([]);
  });
});

describe('blogPostStatusFor / selectDueBlogPosts', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');

  it('publie immédiatement une échéance atteinte, programme les futures', () => {
    expect(blogPostStatusFor(now, now)).toBe('published');
    expect(blogPostStatusFor(new Date(now.getTime() - 1), now)).toBe('published');
    expect(blogPostStatusFor(new Date(now.getTime() + 1), now)).toBe('scheduled');
  });

  it('ne retient que les articles programmés arrivés à échéance', () => {
    const posts = [
      { id: 'a', status: 'scheduled' as const, scheduledFor: new Date(now.getTime() - DAY_MS) },
      { id: 'b', status: 'scheduled' as const, scheduledFor: new Date(now.getTime() + DAY_MS) },
      { id: 'c', status: 'published' as const, scheduledFor: new Date(now.getTime() - DAY_MS) },
      { id: 'd', status: 'draft' as const, scheduledFor: new Date(now.getTime() - DAY_MS) },
    ];
    expect(selectDueBlogPosts(posts, now).map((p) => p.id)).toEqual(['a']);
  });
});

describe('computeInternalLinks', () => {
  it('maille chaque article vers les suivants (circulaire, sans auto-lien)', () => {
    const links = computeInternalLinks(['a', 'b', 'c', 'd'], 2);
    expect(links).toEqual([
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'a'],
      ['a', 'b'],
    ]);
    links.forEach((targets, index) => {
      expect(targets).not.toContain(['a', 'b', 'c', 'd'][index]);
    });
  });

  it('borne le nombre de liens au nombre d’articles disponibles', () => {
    expect(computeInternalLinks(['a', 'b'], 5)).toEqual([['b'], ['a']]);
    expect(computeInternalLinks(['seul'], 2)).toEqual([[]]);
  });

  it('ne laisse aucun article orphelin (tout slug est cité au moins une fois)', () => {
    const slugs = ['a', 'b', 'c', 'd', 'e', 'f'];
    const cited = new Set(computeInternalLinks(slugs).flat());
    expect([...cited].sort()).toEqual(slugs);
  });
});

describe('renderInternalLinksSection / renderCourseCta / assembleBlogMarkdown', () => {
  it('rend un bloc « À lire aussi » avec des liens /blog/{slug}', () => {
    const md = renderInternalLinksSection([{ slug: 'guide-react', title: 'Guide React' }]);
    expect(md).toContain('## À lire aussi');
    expect(md).toContain('[Guide React](/blog/guide-react)');
  });

  it('n’ajoute rien quand il n’y a aucun lien interne', () => {
    expect(renderInternalLinksSection([])).toBe('');
  });

  it('rend un CTA pointant vers la page publique du cours', () => {
    const cta = renderCourseCta('Docker de zéro', '/learn/abc123');
    expect(cta).toContain('Docker de zéro');
    expect(cta).toContain('(/learn/abc123)');
  });

  it('assemble corps + maillage + CTA dans cet ordre', () => {
    const markdown = assembleBlogMarkdown({
      body: '## Intro\n\nTexte.',
      links: [{ slug: 'autre', title: 'Autre article' }],
      courseTitle: 'Docker de zéro',
      courseUrl: '/learn/abc123',
    });
    expect(markdown.indexOf('## Intro')).toBeLessThan(markdown.indexOf('## À lire aussi'));
    expect(markdown.indexOf('## À lire aussi')).toBeLessThan(
      markdown.indexOf('## Aller plus loin avec le cours complet'),
    );
  });
});

describe('countBlogWords / countKeywordOccurrences', () => {
  it('exclut les blocs de code du comptage de mots', () => {
    const md = 'un deux trois\n\n```js\nconst a = 1; const b = 2; const c = 3;\n```\n\nquatre';
    expect(countBlogWords(md)).toBe(4);
  });

  it('compte le mot-clé sans tenir compte de la casse ni des accents', () => {
    expect(countKeywordOccurrences('Tests Automatisés et tests automatises', 'tests automatisés')).toBe(2);
    expect(countKeywordOccurrences('rien ici', 'kubernetes')).toBe(0);
    expect(countKeywordOccurrences('texte', '  ')).toBe(0);
  });
});

describe('validateBlogSeo', () => {
  const keyword = 'tests automatisés';

  it('ne remonte aucun problème sur un article conforme', () => {
    expect(validateBlogSeo(validPost(keyword), keyword)).toEqual([]);
  });

  it('détecte un article trop court', () => {
    const post = validPost(keyword, { markdown: validBody(keyword, 100) });
    const problems = validateBlogSeo(post, keyword);
    expect(problems.some((p) => p.includes('au moins 1200'))).toBe(true);
  });

  it('détecte un manque de sections H2', () => {
    const post = validPost(keyword, {
      markdown: `## Seule section ${keyword} ${keyword} ${keyword}\n\n${'mot '.repeat(BLOG.MIN_WORDS)}`,
    });
    expect(validateBlogSeo(post, keyword).some((p) => p.includes('section(s) H2'))).toBe(true);
  });

  it('refuse un H1 dans le corps', () => {
    const post = validPost(keyword, { markdown: `# Titre\n\n${validBody(keyword)}` });
    expect(validateBlogSeo(post, keyword).some((p) => p.includes('H1'))).toBe(true);
  });

  it('exige le mot-clé dans le titre et une densité minimale dans le corps', () => {
    const post = validPost(keyword, {
      title: 'Un titre sans le terme visé',
      markdown: `## A\n\n${'mot '.repeat(BLOG.MIN_WORDS)}\n\n## B\n\nx\n\n## C\n\nx\n\n## D\n\nx`,
    });
    const problems = validateBlogSeo(post, keyword);
    expect(problems.some((p) => p.includes('titre ne contient pas'))).toBe(true);
    expect(problems.some((p) => p.includes('apparaît 0 fois'))).toBe(true);
  });

  it('détecte une meta description trop courte', () => {
    const post = validPost(keyword, { metaDescription: 'Trop court.' });
    expect(validateBlogSeo(post, keyword).some((p) => p.includes('meta description'))).toBe(true);
  });
});

describe('schémas Zod', () => {
  it('accepte un plan éditorial valide et rejette une intention inconnue', () => {
    const plan = {
      posts: [{ title: 'T', keyword: 'kw', searchIntent: 'informational', angle: 'angle' }],
    };
    expect(blogPlanSchema.safeParse(plan).success).toBe(true);
    const invalid = { posts: [{ title: 'T', keyword: 'kw', searchIntent: 'viral', angle: 'a' }] };
    expect(blogPlanSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejette une meta description au-delà de 160 caractères et une FAQ trop courte', () => {
    const tooLong = validPost('x', { metaDescription: 'a'.repeat(161) });
    expect(blogPostContentSchema.safeParse(tooLong).success).toBe(false);
    const noFaq = { ...validPost('x'), faq: [{ question: 'q', answer: 'a' }] };
    expect(blogPostContentSchema.safeParse(noFaq).success).toBe(false);
  });
});

describe('JSON-LD', () => {
  const base = {
    title: 'Guide React',
    metaDescription: 'Un guide clair.',
    slug: 'guide-react',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-05T00:00:00.000Z'),
    authorName: 'Sally',
    siteUrl: 'https://sallycourse.app/',
    faq: [{ question: 'Q1 ?', answer: 'R1.' }],
    courseUrl: 'https://sallycourse.app/learn/abc',
    courseTitle: 'React de zéro',
  };

  it('produit un BlogPosting canonique pointant vers le cours', () => {
    const ld = blogPostingJsonLd(base) as Record<string, unknown> & { about: { url: string } };
    expect(ld['@type']).toBe('BlogPosting');
    expect(ld['url']).toBe('https://sallycourse.app/blog/guide-react');
    expect(ld.about.url).toBe('https://sallycourse.app/learn/abc');
    expect(ld['datePublished']).toBe('2026-01-01T00:00:00.000Z');
  });

  it('produit un FAQPage, ou null sans question', () => {
    const ld = blogFaqJsonLd(base.faq) as { mainEntity: unknown[] };
    expect(ld.mainEntity).toHaveLength(1);
    expect(blogFaqJsonLd([])).toBeNull();
  });
});
