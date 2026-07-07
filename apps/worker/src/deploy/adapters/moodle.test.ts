// Tests des helpers PURS de l'adapter Moodle (Prompt 42) : encodage des
// paramètres webservice, construction d'URL, détection d'exception, shortname,
// contenu de leçon. Aucun appel réseau.

import { describe, expect, it } from 'vitest';
import type { ILesson } from '../../shared.js';
import {
  encodeMoodleParams,
  isMoodleException,
  moodleCourseUrl,
  moodleEndpoint,
  moodleLessonContent,
  moodleShortname,
} from './moodle.js';

describe('encodeMoodleParams', () => {
  it('aplatit tableaux et objets en clés indexées (format Moodle)', () => {
    const body = encodeMoodleParams({
      courses: [{ fullname: 'Mon cours', shortname: 'abc', categoryid: 1 }],
    });
    expect(body).toContain('courses%5B0%5D%5Bfullname%5D=Mon%20cours');
    expect(body).toContain('courses%5B0%5D%5Bshortname%5D=abc');
    expect(body).toContain('courses%5B0%5D%5Bcategoryid%5D=1');
  });

  it('ignore null et undefined', () => {
    expect(encodeMoodleParams({ a: null, b: undefined, c: 'x' })).toBe('c=x');
  });

  it('encode les caractères spéciaux', () => {
    expect(encodeMoodleParams({ q: 'a&b=c' })).toBe('q=a%26b%3Dc');
  });
});

describe('moodleEndpoint', () => {
  it('construit l’URL server.php avec token, fonction et format json', () => {
    const url = moodleEndpoint('https://lms.example/', 'core_course_create_courses', 'TOK');
    expect(url).toContain('https://lms.example/webservice/rest/server.php?');
    expect(url).toContain('wstoken=TOK');
    expect(url).toContain('wsfunction=core_course_create_courses');
    expect(url).toContain('moodlewsrestformat=json');
    // Slash final de baseUrl normalisé (pas de double slash).
    expect(url).not.toContain('example//webservice');
  });
});

describe('isMoodleException', () => {
  it('détecte l’enveloppe d’erreur Moodle', () => {
    expect(isMoodleException({ exception: 'moodle_exception', message: 'oops', errorcode: 'x' })).toBe(true);
  });
  it('rejette une réponse normale', () => {
    expect(isMoodleException([{ id: 1 }])).toBe(false);
    expect(isMoodleException(null)).toBe(false);
    expect(isMoodleException('str')).toBe(false);
  });
});

describe('moodleShortname', () => {
  it('slugifie, tronque et suffixe avec la fin de l’id', () => {
    const sn = moodleShortname('Développement Web Avancé', 'abcdef123456');
    expect(sn).toMatch(/^developpement-web-avance-123456$/);
  });
  it('repli « course » pour un titre non slugifiable', () => {
    expect(moodleShortname('!!!', 'xxxxxx999999')).toBe('course-999999');
  });
  it('borne la partie slug à 40 caractères', () => {
    const long = 'a'.repeat(100);
    const sn = moodleShortname(long, 'zzzzzz000000');
    // 40 (slug tronqué) + '-' + 6 (suffixe) = 47.
    expect(sn.length).toBe(47);
  });
});

describe('moodleCourseUrl', () => {
  it('construit l’URL de vue cours', () => {
    expect(moodleCourseUrl('https://lms.example/', 42)).toBe('https://lms.example/course/view.php?id=42');
  });
});

describe('moodleLessonContent', () => {
  const lesson = (over: Partial<ILesson>): ILesson =>
    ({ title: 'T', type: 'article', summary: undefined, ...over }) as ILesson;

  it('convertit le Markdown d’un article', () => {
    const html = moodleLessonContent(lesson({ type: 'article' }), '# Titre\n\nTexte.');
    expect(html).toContain('<h1>Titre</h1>');
  });
  it('utilise le résumé pour une vidéo sans article', () => {
    const html = moodleLessonContent(lesson({ type: 'video', summary: 'Résumé vidéo' }), null);
    expect(html).toContain('Résumé vidéo');
  });
  it('repli sur le titre sans contenu', () => {
    const html = moodleLessonContent(lesson({ type: 'video', title: 'Ma leçon' }), null);
    expect(html).toContain('Ma leçon');
  });
});
