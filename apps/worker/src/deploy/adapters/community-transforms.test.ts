// Tests des transformations PURES des adapters communautaires Discord/Telegram
// (Prompt 107) : calendrier de drip, slug de salon, embeds Discord, messages
// texte Telegram. Aucun appel réseau — logique de mapping/format uniquement.
import { describe, expect, it } from 'vitest';
import {
  buildChannelName,
  buildDiscordDripMessage,
  buildDripSchedule,
  buildLessonEmbed,
  buildTelegramDripMessage,
  escapeHtml,
  slugifyChannelName,
} from './community-transforms.js';

describe('buildDripSchedule', () => {
  it('assigne un jour croissant par leçon avec un intervalle de 1 jour par défaut', () => {
    const lessons = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];
    const schedule = buildDripSchedule(lessons);
    expect(schedule).toEqual([
      { index: 0, title: 'A', unlockDay: 0 },
      { index: 1, title: 'B', unlockDay: 1 },
      { index: 2, title: 'C', unlockDay: 2 },
    ]);
  });

  it('espace les déblocages selon intervalDays', () => {
    const lessons = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];
    const schedule = buildDripSchedule(lessons, 3);
    expect(schedule.map((s) => s.unlockDay)).toEqual([0, 3, 6]);
  });

  it('ramène un intervalle invalide (0, négatif, décimal) à un minimum de 1 jour entier', () => {
    const lessons = [{ title: 'A' }, { title: 'B' }];
    expect(buildDripSchedule(lessons, 0).map((s) => s.unlockDay)).toEqual([0, 1]);
    expect(buildDripSchedule(lessons, -5).map((s) => s.unlockDay)).toEqual([0, 1]);
    expect(buildDripSchedule(lessons, 2.9).map((s) => s.unlockDay)).toEqual([0, 2]);
  });

  it('liste vide → calendrier vide', () => {
    expect(buildDripSchedule([])).toEqual([]);
  });
});

describe('slugifyChannelName', () => {
  it('convertit accents/espaces/majuscules en slug ASCII tirets', () => {
    expect(slugifyChannelName('Introduction à React & Hooks')).toBe('introduction-a-react-hooks');
  });

  it('retombe sur "section" si le titre ne produit aucun caractère valide', () => {
    expect(slugifyChannelName('!!!')).toBe('section');
  });

  it('tronque à 90 caractères', () => {
    const long = 'a'.repeat(200);
    expect(slugifyChannelName(long).length).toBeLessThanOrEqual(90);
  });
});

describe('buildChannelName', () => {
  it('préfixe le slug par la position 1-based sur 2 chiffres', () => {
    expect(buildChannelName({ title: 'Les bases', order: 0 })).toBe('01-les-bases');
    expect(buildChannelName({ title: 'Aller plus loin', order: 9 })).toBe('10-aller-plus-loin');
  });
});

describe('buildLessonEmbed', () => {
  it('utilise generatedSummary en priorité, inclut durée et lien vidéo', () => {
    const embed = buildLessonEmbed(
      { title: 'Leçon 1', summary: 'résumé outline', generatedSummary: 'résumé généré', durationMin: 12 },
      'https://cdn.example.com/v1.mp4',
    );
    expect(embed.title).toBe('Leçon 1');
    expect(embed.description).toBe('résumé généré');
    expect(embed.color).toBe(0x5865f2);
    expect(embed.fields).toEqual([
      { name: 'Durée', value: '12 min', inline: true },
      { name: 'Vidéo', value: 'https://cdn.example.com/v1.mp4', inline: false },
    ]);
  });

  it('retombe sur summary puis sur un texte par défaut, omet les champs absents', () => {
    const withSummary = buildLessonEmbed({ title: 'L', summary: 'résumé simple' });
    expect(withSummary.description).toBe('résumé simple');
    expect(withSummary.fields).toEqual([]);

    const empty = buildLessonEmbed({ title: 'L' });
    expect(empty.description).toBe('Nouvelle leçon disponible.');
  });
});

describe('buildDiscordDripMessage', () => {
  it('message immédiat (jour 0) : formulation "débloquée" sans mention de jour', () => {
    const msg = buildDiscordDripMessage({ title: 'Intro' }, { unlockDay: 0 });
    expect(msg.content).toBe('Nouvelle leçon débloquée : **Intro**');
    expect(msg.embeds).toHaveLength(1);
  });

  it('message différé : mentionne le jour de déblocage', () => {
    const msg = buildDiscordDripMessage({ title: 'Suite' }, { unlockDay: 4 });
    expect(msg.content).toBe('Leçon débloquée (jour 4) : **Suite**');
  });
});

describe('buildTelegramDripMessage', () => {
  it('formate en HTML avec titre, résumé, durée et lien vidéo', () => {
    const text = buildTelegramDripMessage(
      { title: 'Leçon <A>', summary: 'un résumé & plus', durationMin: 8 },
      { unlockDay: 0 },
      'https://cdn.example.com/v.mp4',
    );
    expect(text).toContain('Nouvelle leçon débloquée : Leçon &lt;A&gt;');
    expect(text).toContain('un résumé &amp; plus');
    expect(text).toContain('8 min');
    expect(text).toContain('https://cdn.example.com/v.mp4');
  });

  it('mentionne le jour de déblocage si différé', () => {
    const text = buildTelegramDripMessage({ title: 'Suite' }, { unlockDay: 2 });
    expect(text).toContain('Leçon débloquée (jour 2)');
  });
});

describe('escapeHtml', () => {
  it('échappe &, < et >', () => {
    expect(escapeHtml('A & B <C> D')).toBe('A &amp; B &lt;C&gt; D');
  });
});
