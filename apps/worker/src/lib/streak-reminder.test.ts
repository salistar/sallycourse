// Tests du rappel quotidien de série (Prompt 200) — partie PURE du cron :
// sélection des profils à rappeler (série en danger + pas déjà rappelé
// aujourd'hui, en jour UTC) et message envoyé. Aucune I/O, aucun Redis.
import { describe, expect, it } from 'vitest';
import {
  selectProfilesToRemind,
  streakReminderMessage,
  type StreakProfileLike,
} from './streak-reminder.js';

const profile = (overrides: Partial<StreakProfileLike> = {}): StreakProfileLike => ({
  userId: 'u1',
  currentStreak: 5,
  longestStreak: 9,
  lastActiveDay: '2026-07-10',
  ...overrides,
});

// 2026-07-11, 18 h UTC — cadence par défaut du cron.
const NOW = new Date('2026-07-11T18:00:00Z');

describe('selectProfilesToRemind', () => {
  it('retient les profils actifs hier (série en danger)', () => {
    const due = selectProfilesToRemind([profile()], NOW);
    expect(due).toHaveLength(1);
  });

  it('ignore les profils déjà actifs aujourd’hui', () => {
    expect(selectProfilesToRemind([profile({ lastActiveDay: '2026-07-11' })], NOW)).toHaveLength(0);
  });

  it('ignore les séries déjà rompues (dernier jour actif avant-hier)', () => {
    expect(selectProfilesToRemind([profile({ lastActiveDay: '2026-07-09' })], NOW)).toHaveLength(0);
  });

  it('ignore les profils sans série en cours', () => {
    expect(selectProfilesToRemind([profile({ currentStreak: 0 })], NOW)).toHaveLength(0);
  });

  it('n’envoie qu’un rappel par jour UTC (idempotence du cron rejoué)', () => {
    const already = profile({ lastStreakReminderDay: '2026-07-11' });
    expect(selectProfilesToRemind([already], NOW)).toHaveLength(0);
    // Rappel de la veille → un nouveau rappel est dû aujourd'hui.
    const yesterdayReminder = profile({ lastStreakReminderDay: '2026-07-10' });
    expect(selectProfilesToRemind([yesterdayReminder], NOW)).toHaveLength(1);
  });

  it('filtre un lot mixte sans muter l’entrée', () => {
    const input = [
      profile({ userId: 'a' }),
      profile({ userId: 'b', lastActiveDay: '2026-07-11' }),
      profile({ userId: 'c', lastStreakReminderDay: '2026-07-11' }),
      profile({ userId: 'd', currentStreak: 30 }),
    ];
    const due = selectProfilesToRemind(input, NOW);
    expect(due.map((p) => p.userId)).toEqual(['a', 'd']);
    expect(input).toHaveLength(4);
  });
});

describe('streakReminderMessage', () => {
  it('mentionne la longueur de la série', () => {
    expect(streakReminderMessage(3).title).toContain('3 jour(s)');
  });

  it('insiste sur l’enjeu au-delà de 7 jours', () => {
    expect(streakReminderMessage(12).body).toContain('12 jours');
    expect(streakReminderMessage(2).body).not.toContain('2 jours');
  });
});
