import { describe, expect, it } from 'vitest';
import { buildPodcastRss, isLocalMediaBase, type Episode } from './podcast.js';

describe('buildPodcastRss (P202)', () => {
  const episodes: Episode[] = [
    { order: 0, title: 'Introduction & <bases>', key: 'courses/c1/podcast/episode-0.mp3', durationSec: 320, bytes: 5_120_000 },
    { order: 1, title: 'Aller plus loin', key: 'courses/c1/podcast/episode-1.mp3', durationSec: 540, bytes: 8_640_000 },
  ];

  it('produit un flux RSS 2.0 avec un item par épisode', () => {
    const xml = buildPodcastRss('Mon cours', 'fr', episodes);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<language>fr</language>');
    expect((xml.match(/<item>/g) ?? [])).toHaveLength(2);
    expect(xml).toContain('type="audio/mpeg"');
    expect(xml).toContain('<itunes:duration>320</itunes:duration>');
  });

  it('déclare la TAILLE réelle de chaque enclosure (length="0" était refusé par Apple/Spotify)', () => {
    const xml = buildPodcastRss('Mon cours', 'fr', episodes);
    expect(xml).toContain('length="5120000"');
    expect(xml).toContain('length="8640000"');
    expect(xml).not.toContain('length="0"');
  });

  it('échappe le HTML dans les titres (pas de balise injectée)', () => {
    const xml = buildPodcastRss('Cours & Cie', 'fr', episodes);
    expect(xml).toContain('Introduction &amp; &lt;bases&gt;');
    expect(xml).not.toContain('<bases>');
  });

  it('inclut les métadonnées iTunes minimales (correctif 1.3, audit 2026-07-20)', () => {
    const generatedAt = new Date('2026-07-20T10:00:00Z');
    const xml = buildPodcastRss('Mon cours', 'fr', episodes, {
      imageUrl: 'https://cdn.example.com/cover.png',
      generatedAt,
    });
    expect(xml).toContain('<itunes:author>SallyCourse</itunes:author>');
    expect(xml).toContain('<itunes:explicit>false</itunes:explicit>');
    expect(xml).toContain('<itunes:category text="Education" />');
    expect(xml).toContain('<itunes:image href="https://cdn.example.com/cover.png" />');
    expect(xml).toContain(`<lastBuildDate>${generatedAt.toUTCString()}</lastBuildDate>`);
    // pubDate présent sur chaque item, pas seulement le channel.
    expect((xml.match(/<pubDate>/g) ?? [])).toHaveLength(episodes.length);
  });

  it('omet itunes:image quand aucune cover n’est fournie (pas de balise avec href vide)', () => {
    const xml = buildPodcastRss('Mon cours', 'fr', episodes);
    expect(xml).not.toContain('<itunes:image');
  });
});

describe('isLocalMediaBase (correctif 1.3, audit 2026-07-20)', () => {
  it('considère une base vide comme locale (aucune diffusion publique possible)', () => {
    expect(isLocalMediaBase('')).toBe(true);
  });

  it('détecte localhost/127.0.0.1/::1 et les sous-domaines .localhost', () => {
    for (const base of [
      'http://localhost:9000/sallycourse',
      'http://127.0.0.1:9000/sallycourse',
      'http://app.localhost/sallycourse',
    ]) {
      expect(isLocalMediaBase(base), base).toBe(true);
    }
  });

  it('accepte une base publique réelle', () => {
    expect(isLocalMediaBase('https://media.sallycourse.com')).toBe(false);
    expect(isLocalMediaBase('https://cdn.example.com/bucket')).toBe(false);
  });
});
