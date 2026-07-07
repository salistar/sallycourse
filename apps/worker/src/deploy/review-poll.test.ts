// Tests de la logique PURE du polling review (P47) : normalisation d'état,
// transition/notification, parsing des raisons de rejet → plan de correction.
// Aucun appel réseau/navigateur : tout est déterministe et hors-ligne.
import { describe, expect, it } from 'vitest';
import {
  normalizeReviewState,
  isActionableReviewState,
  isApprovedReviewState,
  reviewTransition,
  deploymentStatusFromReview,
  categorizeReason,
  severityOfReason,
  parseRejectionReasons,
  dedupeReasons,
  buildCorrectionPlanUser,
  mockCorrectionPlan,
  generateCorrectionPlan,
  correctionPlanSchema,
  storeReviewState,
  readStoredReviewState,
  type ReviewState,
} from './review-poll.js';
import type { DeploymentDocument } from '../shared.js';
import type { ICourse } from '../shared.js';

const course = { title: 'Fiscalité au Maroc' } as ICourse;

describe('normalizeReviewState', () => {
  it('mappe les libellés de rejet', () => {
    for (const s of ['Rejected', 'course declined', 'REFUSÉ', 'not approved', 'denied']) {
      expect(normalizeReviewState(s)).toBe('rejected');
    }
  });
  it('mappe les demandes de modification', () => {
    for (const s of ['Changes requested', 'please resubmit', 'action required', 'needs revision']) {
      expect(normalizeReviewState(s)).toBe('changes_requested');
    }
  });
  it('mappe approuvé/publié', () => {
    for (const s of ['Approved', 'Published', 'live', 'en ligne', 'accepted']) {
      expect(normalizeReviewState(s)).toBe('approved');
    }
  });
  it('mappe en revue', () => {
    for (const s of ['In review', 'pending', 'submitted', 'en revue']) {
      expect(normalizeReviewState(s)).toBe('in_review');
    }
  });
  it('retourne unknown pour vide/inconnu', () => {
    expect(normalizeReviewState(undefined)).toBe('unknown');
    expect(normalizeReviewState('')).toBe('unknown');
    expect(normalizeReviewState('blablabla')).toBe('unknown');
  });
  it('rejet a priorité sur revue quand les deux apparaissent', () => {
    expect(normalizeReviewState('review rejected')).toBe('rejected');
  });
});

describe('helpers d’état', () => {
  it('isActionableReviewState', () => {
    expect(isActionableReviewState('rejected')).toBe(true);
    expect(isActionableReviewState('changes_requested')).toBe(true);
    expect(isActionableReviewState('approved')).toBe(false);
    expect(isActionableReviewState('in_review')).toBe(false);
  });
  it('isApprovedReviewState', () => {
    expect(isApprovedReviewState('approved')).toBe(true);
    expect(isApprovedReviewState('rejected')).toBe(false);
  });
});

describe('reviewTransition', () => {
  it('notifie à l’entrée dans rejected', () => {
    const t = reviewTransition('in_review', 'rejected');
    expect(t.changed).toBe(true);
    expect(t.notify).toBe('rejected');
    expect(t.keepPolling).toBe(true);
  });
  it('notifie à l’approbation et arrête le polling', () => {
    const t = reviewTransition('in_review', 'approved');
    expect(t.notify).toBe('approved');
    expect(t.keepPolling).toBe(false);
  });
  it('notifie les modifications demandées', () => {
    const t = reviewTransition('in_review', 'changes requested');
    expect(t.notify).toBe('changes_requested');
  });
  it('ne re-notifie pas un état inchangé', () => {
    const t = reviewTransition('rejected', 'rejected');
    expect(t.changed).toBe(false);
    expect(t.notify).toBeNull();
  });
  it('pas de notification pour in_review → in_review', () => {
    const t = reviewTransition('pending', 'submitted');
    expect(t.next).toBe('in_review');
    expect(t.notify).toBeNull();
  });
  it('gère les entrées nulles', () => {
    const t = reviewTransition(null, 'approved');
    expect(t.previous).toBe('unknown');
    expect(t.notify).toBe('approved');
  });
});

describe('deploymentStatusFromReview', () => {
  it('approuvé → published', () => {
    expect(deploymentStatusFromReview('approved', 'running')).toBe('published');
  });
  it('rejeté → failed', () => {
    expect(deploymentStatusFromReview('rejected', 'running')).toBe('failed');
  });
  it('modifs demandées → conserve le statut courant', () => {
    expect(deploymentStatusFromReview('changes_requested', 'running')).toBe('running');
  });
  it('in_review → conserve', () => {
    expect(deploymentStatusFromReview('in_review', 'running')).toBe('running');
  });
});

describe('categorizeReason / severityOfReason', () => {
  it('catégorise par mots-clés', () => {
    expect(categorizeReason('Audio quality is poor')).toBe('audio');
    expect(categorizeReason('La vidéo est floue')).toBe('video');
    expect(categorizeReason('Missing subtitles / srt')).toBe('captions');
    expect(categorizeReason('Copyright violation détectée')).toBe('legal');
    expect(categorizeReason('Improve the landing description')).toBe('landing');
    expect(categorizeReason('Le quiz est incomplet')).toBe('assessment');
    expect(categorizeReason('Curriculum structure unclear')).toBe('content');
    expect(categorizeReason('Autre remarque')).toBe('general');
  });
  it('déduit la sévérité', () => {
    expect(severityOfReason('This is a policy violation, must fix')).toBe('blocker');
    expect(severityOfReason('You should improve the quality')).toBe('major');
    expect(severityOfReason('Small note here')).toBe('minor');
  });
});

describe('parseRejectionReasons', () => {
  it('parse une liste à puces', () => {
    const raw = '- Audio trop faible\n- Vidéo floue\n* Copyright non prouvé';
    const reasons = parseRejectionReasons(raw);
    expect(reasons.map((r) => r.text)).toEqual([
      'Audio trop faible',
      'Vidéo floue',
      'Copyright non prouvé',
    ]);
    expect(reasons[0]!.category).toBe('audio');
    expect(reasons[2]!.category).toBe('legal');
  });
  it('parse une liste numérotée', () => {
    const raw = '1. Première raison\n2) Deuxième raison';
    expect(parseRejectionReasons(raw).map((r) => r.text)).toEqual([
      'Première raison',
      'Deuxième raison',
    ]);
  });
  it('retombe sur un découpage par phrases si une seule ligne', () => {
    const raw = 'Audio trop faible. Vidéo floue; Copyright non prouvé';
    expect(parseRejectionReasons(raw).length).toBe(3);
  });
  it('déduplique et ignore le vide', () => {
    const raw = '- Même raison\n- même raison\n-   \n- Autre';
    expect(parseRejectionReasons(raw).map((r) => r.text)).toEqual(['Même raison', 'Autre']);
  });
  it('retourne vide pour entrée vide/null', () => {
    expect(parseRejectionReasons('')).toEqual([]);
    expect(parseRejectionReasons(undefined)).toEqual([]);
  });
});

describe('dedupeReasons', () => {
  it('supprime les doublons par texte insensible à la casse', () => {
    const reasons = parseRejectionReasons('- A\n- B').concat(parseRejectionReasons('- a\n- C'));
    expect(dedupeReasons(reasons).map((r) => r.text)).toEqual(['A', 'B', 'C']);
  });
});

describe('buildCorrectionPlanUser', () => {
  it('inclut le titre du cours et les raisons numérotées', () => {
    const reasons = parseRejectionReasons('- Audio trop faible\n- Copyright non prouvé');
    const user = buildCorrectionPlanUser(course, reasons);
    expect(user).toContain('Fiscalité au Maroc');
    expect(user).toContain('1. ');
    expect(user).toContain('Audio trop faible');
  });
});

describe('mockCorrectionPlan', () => {
  it('produit une tâche par raison, conforme au schéma', () => {
    const reasons = parseRejectionReasons('- Audio trop faible\n- Copyright non prouvé\n- Curriculum unclear');
    const plan = mockCorrectionPlan(course, reasons);
    expect(correctionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.tasks).toHaveLength(3);
    // Le point légal n'est PAS régénérable automatiquement.
    const legal = plan.tasks.find((t) => t.category === 'legal');
    expect(legal?.regenerable).toBe(false);
    // Le point contenu vise le cours entier.
    const content = plan.tasks.find((t) => t.category === 'content');
    expect(content?.scope).toBe('course');
  });
  it('fournit une tâche par défaut si aucune raison', () => {
    const plan = mockCorrectionPlan(course, []);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.regenerable).toBe(false);
  });
});

describe('generateCorrectionPlan (mock)', () => {
  it('retourne un plan valide en mode mock sans réseau', async () => {
    const reasons = parseRejectionReasons('- Audio trop faible\n- Vidéo floue');
    const plan = await generateCorrectionPlan(course, reasons, true);
    expect(correctionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.tasks.length).toBe(2);
  });
});

describe('storeReviewState / readStoredReviewState', () => {
  it('round-trip via checkpoint.step', () => {
    const deployment = { checkpoint: { lessonIndex: 3, step: '' }, logs: [] } as unknown as DeploymentDocument;
    for (const state of ['in_review', 'rejected', 'approved', 'changes_requested'] as ReviewState[]) {
      storeReviewState(deployment, state);
      expect(deployment.checkpoint.step).toBe(`review:${state}`);
      expect(readStoredReviewState(deployment)).toBe(state);
    }
    // lessonIndex préservé.
    expect(deployment.checkpoint.lessonIndex).toBe(3);
  });
  it('unknown si aucun état stocké', () => {
    const deployment = { checkpoint: { lessonIndex: 0, step: 'upload' }, logs: [] } as unknown as DeploymentDocument;
    expect(readStoredReviewState(deployment)).toBe('unknown');
  });
});
