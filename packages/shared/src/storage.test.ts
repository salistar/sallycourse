import { describe, expect, it } from 'vitest';
import { storageKeys } from './storage';

// Tests purs des générateurs de clés — aucun appel réseau.

describe('storageKeys', () => {
  const course = storageKeys.course('abc123');

  it('expose le préfixe racine du cours', () => {
    expect(course.prefix).toBe('courses/abc123');
  });

  it('génère les clés de leçon (vidéo, article, quiz)', () => {
    const lesson = course.lesson(2, 5);
    expect(lesson.prefix).toBe('courses/abc123/sections/2/lessons/5');
    expect(lesson.video()).toBe('courses/abc123/sections/2/lessons/5/video.mp4');
    expect(lesson.article()).toBe('courses/abc123/sections/2/lessons/5/article.md');
    expect(lesson.quiz()).toBe('courses/abc123/sections/2/lessons/5/quiz.json');
  });

  it('génère les clés de captures et sous-titres', () => {
    const lesson = course.lesson(1, 1);
    expect(lesson.screenshot(0)).toBe('courses/abc123/sections/1/lessons/1/screenshots/0.png');
    expect(lesson.screenshot(12)).toBe('courses/abc123/sections/1/lessons/1/screenshots/12.png');
    expect(lesson.captionsSrt()).toBe('courses/abc123/sections/1/lessons/1/captions.srt');
    expect(lesson.captionsVtt()).toBe('courses/abc123/sections/1/lessons/1/captions.vtt');
  });

  it('génère les clés audio par slide', () => {
    const lesson = course.lesson(3, 4);
    expect(lesson.audio(0)).toBe('courses/abc123/sections/3/lessons/4/audio/0.mp3');
    expect(lesson.audio(7)).toBe('courses/abc123/sections/3/lessons/4/audio/7.mp3');
  });

  it('génère les clés marketing et exports', () => {
    expect(course.marketing('thumbnail.png')).toBe('courses/abc123/marketing/thumbnail.png');
    expect(course.exportFile('course.zip')).toBe('courses/abc123/exports/course.zip');
  });

  it('isole chaque cours sous son propre préfixe', () => {
    const other = storageKeys.course('xyz789');
    expect(other.lesson(1, 1).video()).toBe('courses/xyz789/sections/1/lessons/1/video.mp4');
    expect(other.prefix).not.toBe(course.prefix);
  });
});
