import { describe, expect, it } from 'vitest';
import {
  EMAIL_TEMPLATES,
  escapeHtml,
  renderEmailTemplate,
  type EmailTemplateName,
} from './templates';

// Tests de RENDU des gabarits email (P59) — logique pure, aucun envoi réseau.

const ALL_TEMPLATES = Object.keys(EMAIL_TEMPLATES) as EmailTemplateName[];

describe('renderEmailTemplate — invariants communs', () => {
  it('rend chaque gabarit avec sujet, html et texte non vides', () => {
    for (const name of ALL_TEMPLATES) {
      const out = renderEmailTemplate(name, {
        name: 'Sally',
        courseTitle: 'React de zéro',
        platform: 'Udemy',
        plan: 'Pro',
        reason: 'Audio à retravailler',
        actionUrl: 'https://app.example.com/x',
      });
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('<!doctype html>');
      expect(out.html).toContain('SallyCourse');
      expect(out.text.length).toBeGreaterThan(0);
    }
  });

  it('jette sur un gabarit inconnu', () => {
    expect(() => renderEmailTemplate('inexistant' as EmailTemplateName)).toThrow();
  });

  it('inclut le bouton d’action quand une URL est fournie, sinon non', () => {
    const withUrl = renderEmailTemplate('generation_complete', {
      actionUrl: 'https://app.example.com/dashboard/courses/1',
    });
    expect(withUrl.html).toContain('href="https://app.example.com/dashboard/courses/1"');

    const withoutUrl = renderEmailTemplate('generation_complete', {});
    expect(withoutUrl.html).not.toContain('<a href');
  });

  it('interpole le nom du destinataire dans la salutation', () => {
    const out = renderEmailTemplate('generation_complete', { name: 'Sally' });
    expect(out.html).toContain('Bonjour Sally,');
    const anon = renderEmailTemplate('generation_complete', {});
    expect(anon.html).toContain('Bonjour,');
  });
});

describe('escapeHtml — anti-injection', () => {
  it('échappe les caractères sensibles', () => {
    expect(escapeHtml('<b>"x"&\'</b>')).toBe(
      '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;',
    );
  });

  it('échappe un titre de cours malveillant dans le HTML rendu', () => {
    const out = renderEmailTemplate('generation_complete', {
      courseTitle: '<script>alert(1)</script>',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});

describe('gabarits spécifiques', () => {
  it('generation_complete cite le titre du cours', () => {
    const out = renderEmailTemplate('generation_complete', { courseTitle: 'Docker' });
    expect(out.subject).toContain('Docker');
    expect(out.html).toContain('Docker');
    expect(out.text).toContain('Docker');
  });

  it('deployment_complete cite la plateforme', () => {
    const out = renderEmailTemplate('deployment_complete', {
      courseTitle: 'Docker',
      platform: 'Udemy',
    });
    expect(out.html).toContain('Udemy');
    expect(out.subject).toContain('Docker');
  });

  it('review_approved indique la publication', () => {
    const out = renderEmailTemplate('review_approved', {
      courseTitle: 'Docker',
      platform: 'Udemy',
    });
    expect(out.subject.toLowerCase()).toContain('approuvée');
    expect(out.html).toContain('Udemy');
  });

  it('review_rejected inclut le motif quand fourni, l’omet sinon', () => {
    const withReason = renderEmailTemplate('review_rejected', {
      courseTitle: 'Docker',
      platform: 'Udemy',
      reason: 'Audio de mauvaise qualité',
    });
    expect(withReason.html).toContain('Audio de mauvaise qualité');
    expect(withReason.text).toContain('Audio de mauvaise qualité');

    const noReason = renderEmailTemplate('review_rejected', {
      courseTitle: 'Docker',
      platform: 'Udemy',
    });
    expect(noReason.html).not.toContain('Motif :');
  });

  it('quota_reached cite le plan et pointe vers les offres', () => {
    const out = renderEmailTemplate('quota_reached', {
      plan: 'Pro',
      actionUrl: 'https://app.example.com/pricing',
      actionLabel: 'Voir les offres',
    });
    expect(out.subject.toLowerCase()).toContain('quota');
    expect(out.html).toContain('Pro');
    expect(out.html).toContain('Voir les offres');
  });
});
