// Tests purs (P200) : barème XP, courbe de niveaux, streaks en jour UTC,
// badges et classement anonymisable. Aucune I/O.
import { describe, expect, it } from 'vitest';
import {
  BADGES,
  BADGE_IDS,
  XP_RULES,
  dayKeyUtc,
  evaluateBadges,
  findBadge,
  isStreakAtRisk,
  leaderboardDisplayName,
  levelForXp,
  rankLeaderboard,
  shiftDayKeyUtc,
  updateStreak,
  xpForLessonCompletion,
  xpForLessonEvent,
  xpForLevel,
  xpForQuiz,
  xpToNextLevel,
  type BadgeState,
} from './gamification';

describe('barème XP', () => {
  it('accorde 10 XP pour une leçon terminée', () => {
    expect(xpForLessonCompletion()).toBe(10);
  });

  it('accorde 5 / 10 / 20 XP au quiz selon les paliers de score', () => {
    expect(xpForQuiz(0)).toBe(5);
    expect(xpForQuiz(49)).toBe(5);
    expect(xpForQuiz(50)).toBe(10);
    expect(xpForQuiz(79)).toBe(10);
    expect(xpForQuiz(80)).toBe(20);
    expect(xpForQuiz(100)).toBe(20);
  });

  it('borne les scores hors [0,100]', () => {
    expect(xpForQuiz(-30)).toBe(5);
    expect(xpForQuiz(150)).toBe(20);
  });

  it('cumule leçon + quiz + bonus de première leçon du jour', () => {
    expect(xpForLessonEvent({ firstOfDay: false })).toEqual({
      lesson: 10,
      quiz: 0,
      dailyBonus: 0,
      total: 10,
    });
    expect(xpForLessonEvent({ firstOfDay: true })).toEqual({
      lesson: 10,
      quiz: 0,
      dailyBonus: 5,
      total: 15,
    });
    expect(xpForLessonEvent({ quizScore: 90, firstOfDay: true })).toEqual({
      lesson: 10,
      quiz: 20,
      dailyBonus: 5,
      total: 35,
    });
    expect(xpForLessonEvent({ quizScore: 20, firstOfDay: false }).total).toBe(
      XP_RULES.lessonCompleted + XP_RULES.quiz.low,
    );
  });
});

describe('courbe de niveaux', () => {
  it('exprime les seuils cumulés 0 / 100 / 300 / 600 / 1000', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(4)).toBe(600);
    expect(xpForLevel(5)).toBe(1000);
  });

  it('déduit le niveau de l’XP cumulé (bornes incluses)', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
    expect(levelForXp(1000)).toBe(5);
  });

  it('reste cohérent sur toute la plage : xpForLevel(levelForXp(x)) <= x < xpForLevel(level+1)', () => {
    for (let xp = 0; xp <= 5000; xp += 7) {
      const level = levelForXp(xp);
      expect(xpForLevel(level)).toBeLessThanOrEqual(xp);
      expect(xpForLevel(level + 1)).toBeGreaterThan(xp);
    }
  });

  it('traite l’XP négatif comme 0 (niveau 1)', () => {
    expect(levelForXp(-50)).toBe(1);
  });

  it('calcule la progression vers le niveau suivant', () => {
    expect(xpToNextLevel(150)).toEqual({
      level: 2,
      levelStartXp: 100,
      nextLevelXp: 300,
      xpIntoLevel: 50,
      xpRemaining: 150,
      percent: 25,
    });
    expect(xpToNextLevel(0).percent).toBe(0);
    expect(xpToNextLevel(0).xpRemaining).toBe(100);
  });
});

describe('streaks (jour UTC)', () => {
  const at = (iso: string) => new Date(iso);

  it('utilise le jour UTC, pas le fuseau local', () => {
    // 23h30 UTC le 3 → jour « 2026-07-03 » quelle que soit la machine.
    expect(dayKeyUtc(at('2026-07-03T23:30:00Z'))).toBe('2026-07-03');
    expect(dayKeyUtc(at('2026-07-04T00:10:00Z'))).toBe('2026-07-04');
    expect(shiftDayKeyUtc(at('2026-07-01T05:00:00Z'), -1)).toBe('2026-06-30');
  });

  it('démarre une série à 1 à la première activité', () => {
    const res = updateStreak({ currentStreak: 0, longestStreak: 0, lastActiveDay: null }, at('2026-07-10T09:00:00Z'));
    expect(res).toEqual({ current: 1, longest: 1, broken: false, firstOfDay: true, day: '2026-07-10' });
  });

  it('n’incrémente pas deux fois le même jour et ne re-donne pas le bonus', () => {
    const res = updateStreak(
      { currentStreak: 3, longestStreak: 5, lastActiveDay: '2026-07-10' },
      at('2026-07-10T22:00:00Z'),
    );
    expect(res.current).toBe(3);
    expect(res.longest).toBe(5);
    expect(res.firstOfDay).toBe(false);
    expect(res.broken).toBe(false);
  });

  it('incrémente au jour suivant et met à jour le record', () => {
    const res = updateStreak(
      { currentStreak: 6, longestStreak: 6, lastActiveDay: '2026-07-10' },
      at('2026-07-11T06:00:00Z'),
    );
    expect(res).toEqual({ current: 7, longest: 7, broken: false, firstOfDay: true, day: '2026-07-11' });
  });

  it('casse la série après un jour sauté et conserve le record', () => {
    const res = updateStreak(
      { currentStreak: 9, longestStreak: 12, lastActiveDay: '2026-07-08' },
      at('2026-07-11T06:00:00Z'),
    );
    expect(res).toEqual({ current: 1, longest: 12, broken: true, firstOfDay: true, day: '2026-07-11' });
  });

  it('signale une série en danger uniquement si l’activité date d’hier', () => {
    const now = at('2026-07-11T18:00:00Z');
    expect(isStreakAtRisk({ currentStreak: 4, longestStreak: 4, lastActiveDay: '2026-07-10' }, now)).toBe(true);
    // Déjà actif aujourd'hui → rien à rappeler.
    expect(isStreakAtRisk({ currentStreak: 4, longestStreak: 4, lastActiveDay: '2026-07-11' }, now)).toBe(false);
    // Série déjà rompue (avant-hier) → plus rien à sauver.
    expect(isStreakAtRisk({ currentStreak: 4, longestStreak: 4, lastActiveDay: '2026-07-09' }, now)).toBe(false);
    // Aucune série en cours.
    expect(isStreakAtRisk({ currentStreak: 0, longestStreak: 3, lastActiveDay: '2026-07-10' }, now)).toBe(false);
  });
});

describe('badges', () => {
  const state = (overrides: Partial<BadgeState> = {}): BadgeState => ({
    earned: [],
    lessonsCompleted: 0,
    tpCompleted: 0,
    hasPerfectQuiz: false,
    coursesCompleted: 0,
    currentStreak: 0,
    ...overrides,
  });

  it('expose un catalogue aligné sur BADGE_IDS', () => {
    expect(BADGES.map((b) => b.id)).toEqual([...BADGE_IDS]);
    expect(findBadge('streak_7')?.label).toBe('Série de 7 jours');
    expect(findBadge('inconnu')).toBeUndefined();
  });

  it('débloque la première leçon et le premier TP', () => {
    expect(evaluateBadges(state({ lessonsCompleted: 1 }))).toEqual(['first_lesson']);
    expect(evaluateBadges(state({ lessonsCompleted: 3, tpCompleted: 1 }))).toEqual([
      'first_lesson',
      'first_tp',
    ]);
  });

  it('ne re-attribue jamais un badge déjà obtenu', () => {
    expect(
      evaluateBadges(state({ earned: ['first_lesson'], lessonsCompleted: 4, hasPerfectQuiz: true })),
    ).toEqual(['perfect_quiz']);
  });

  it('débloque les paliers de streak', () => {
    expect(evaluateBadges(state({ currentStreak: 6 }))).toEqual([]);
    expect(evaluateBadges(state({ currentStreak: 7 }))).toEqual(['streak_7']);
    expect(evaluateBadges(state({ currentStreak: 30 }))).toEqual(['streak_7', 'streak_30']);
  });

  it('débloque le cours terminé', () => {
    expect(evaluateBadges(state({ coursesCompleted: 1 }))).toContain('course_completed');
  });
});

describe('classement', () => {
  it('affiche prénom + initiale, jamais l’email', () => {
    expect(leaderboardDisplayName('Amina El Fassi')).toBe('Amina E.');
    expect(leaderboardDisplayName('Yassine')).toBe('Yassine');
    expect(leaderboardDisplayName('  ')).toBe('Apprenant');
    expect(leaderboardDisplayName(null)).toBe('Apprenant');
  });

  it('anonymise en cas d’opt-out', () => {
    expect(leaderboardDisplayName('Amina El Fassi', true)).toBe('Apprenant');
  });

  it('trie par XP décroissant et marque l’apprenant courant', () => {
    const rows = rankLeaderboard(
      [
        { studentId: 'a', xp: 40, name: 'Ali Ben' },
        { studentId: 'b', xp: 120, name: 'Sara Nour' },
        { studentId: 'c', xp: 80, name: 'Omar Idrissi', optOut: true },
      ],
      'a',
    );
    expect(rows.map((r) => [r.rank, r.displayName, r.xp])).toEqual([
      [1, 'Sara N.', 120],
      [2, 'Apprenant', 80],
      [3, 'Ali B.', 40],
    ]);
    expect(rows.find((r) => r.isViewer)?.studentId).toBe('a');
  });

  it('applique un rang de compétition aux ex æquo (1, 2, 2, 4) de façon déterministe', () => {
    const rows = rankLeaderboard([
      { studentId: 'z', xp: 50, name: 'Zoe M' },
      { studentId: 'y', xp: 90, name: 'Yann K' },
      { studentId: 'x', xp: 50, name: 'Xavier P' },
      { studentId: 'w', xp: 10, name: 'Wafa T' },
    ]);
    expect(rows.map((r) => [r.studentId, r.rank])).toEqual([
      ['y', 1],
      ['x', 2],
      ['z', 2],
      ['w', 4],
    ]);
  });

  it('retourne une liste vide sans entrée', () => {
    expect(rankLeaderboard([])).toEqual([]);
  });
});
