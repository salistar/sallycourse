// Tests de l'agrégation PURE du rapport de déploiement (P50) — aucune I/O.
import { describe, expect, it } from 'vitest';
import {
  buildChecklist,
  buildDeploymentReportData,
  deploymentReportFilename,
  formatDurationMs,
  platformLabel,
  toReportPlatform,
  type DeploymentLike,
} from './report.js';

/** Fabrique un Deployment-like minimal pour les tests. */
function dep(over: Partial<DeploymentLike>): DeploymentLike {
  return {
    platform: 'udemy',
    status: 'published',
    mode: 'auto',
    externalUrl: '',
    externalId: '',
    checkpoint: { lessonIndex: 0, step: '' },
    createdAt: new Date('2026-07-07T10:00:00Z'),
    updatedAt: new Date('2026-07-07T10:05:00Z'),
    logs: [],
    ...over,
  } as DeploymentLike;
}

describe('platformLabel', () => {
  it('mappe les plateformes connues', () => {
    expect(platformLabel('udemy')).toBe('Udemy');
    expect(platformLabel('youtube')).toBe('YouTube');
  });
  it('capitalise les plateformes inconnues', () => {
    expect(platformLabel('coursera')).toBe('Coursera');
  });
});

describe('formatDurationMs', () => {
  it('retourne un tiret pour une durée nulle ou négative', () => {
    expect(formatDurationMs(0)).toBe('—');
    expect(formatDurationMs(-100)).toBe('—');
    expect(formatDurationMs(Number.NaN)).toBe('—');
  });
  it('formate secondes, minutes, heures', () => {
    expect(formatDurationMs(45_000)).toBe('45 s');
    expect(formatDurationMs(5 * 60_000 + 12_000)).toBe('5 min 12 s');
    expect(formatDurationMs(2 * 3600_000 + 30 * 60_000)).toBe('2 h 30 min');
  });
});

describe('toReportPlatform', () => {
  it('calcule la durée entre createdAt et updatedAt', () => {
    const row = toReportPlatform(dep({}));
    expect(row.duration).toBe('5 min 0 s');
    expect(row.platform).toBe('Udemy');
    expect(row.statusLabel).toBe('Publié');
    expect(row.mode).toBe('Automatique');
  });

  it('borne les leçons uploadées et remonte URL/externalId', () => {
    const row = toReportPlatform(
      dep({
        checkpoint: { lessonIndex: 12, step: 'done' },
        externalUrl: 'https://udemy.com/c/x',
        externalId: 'abc123',
      }),
    );
    expect(row.lessonsUploaded).toBe(12);
    expect(row.externalUrl).toBe('https://udemy.com/c/x');
    expect(row.externalId).toBe('abc123');
  });

  it('dérive reviewState : approved si publié, in_review au step review', () => {
    expect(toReportPlatform(dep({ status: 'published' })).reviewState).toBe('approved');
    expect(
      toReportPlatform(
        dep({ status: 'running', checkpoint: { lessonIndex: 3, step: 'review' } }),
      ).reviewState,
    ).toBe('in_review');
    expect(toReportPlatform(dep({ status: 'failed', checkpoint: { lessonIndex: 1, step: 'upload' } })).reviewState).toBe('');
  });

  it('durée « — » quand les dates manquent', () => {
    expect(toReportPlatform(dep({ createdAt: undefined, updatedAt: undefined })).duration).toBe('—');
  });
});

describe('buildChecklist', () => {
  it('signale l\'absence de plateforme en warn', () => {
    const items = buildChecklist([]);
    expect(items[0]?.tone).toBe('warn');
    expect(items.every((i) => typeof i.title === 'string')).toBe(true);
  });

  it('tout publié → tons ok', () => {
    const platforms = [
      toReportPlatform(dep({ platform: 'udemy', externalUrl: 'https://u/1' })),
      toReportPlatform(dep({ platform: 'youtube', externalUrl: 'https://y/2' })),
    ];
    const items = buildChecklist(platforms);
    // Aucun item d'erreur si tout est publié avec URL.
    expect(items.find((i) => i.title.includes('en échec'))?.tone).toBe('ok');
    expect(items.find((i) => i.title.includes('publiée'))?.tone).toBe('ok');
  });

  it('un échec → item err listant la plateforme', () => {
    const platforms = [
      toReportPlatform(dep({ platform: 'udemy', status: 'published', externalUrl: 'https://u/1' })),
      toReportPlatform(dep({ platform: 'skillshare', status: 'failed' })),
    ];
    const items = buildChecklist(platforms);
    const failItem = items.find((i) => i.title.includes('en échec'));
    expect(failItem?.tone).toBe('err');
    expect(failItem?.detail).toContain('Skillshare');
  });
});

describe('buildDeploymentReportData', () => {
  it('trie les plateformes (publié > échec > en cours) et remplit les champs', () => {
    const data = buildDeploymentReportData({
      courseTitle: 'Docker de A à Z',
      locale: 'fr',
      generatedAt: new Date('2026-07-07T14:32:00Z'),
      deployments: [
        dep({ platform: 'skillshare', status: 'failed' }),
        dep({ platform: 'udemy', status: 'published', externalUrl: 'https://u/1' }),
        dep({ platform: 'youtube', status: 'running', checkpoint: { lessonIndex: 2, step: 'upload' } }),
      ],
    });
    expect(data.courseTitle).toBe('Docker de A à Z');
    expect(data.direction).toBe('ltr');
    expect((data.platforms ?? []).map((p) => p.status)).toEqual(['published', 'failed', 'running']);
    expect(data.generatedLine).toContain('Généré le');
    expect((data.checklist ?? []).length).toBeGreaterThan(0);
  });

  it('locale ar → direction rtl', () => {
    const data = buildDeploymentReportData({ courseTitle: 'دورة', locale: 'ar', deployments: [] });
    expect(data.direction).toBe('rtl');
    expect(data.platforms ?? []).toEqual([]);
  });
});

describe('deploymentReportFilename', () => {
  it('produit un nom horodaté .pdf', () => {
    expect(deploymentReportFilename(1234)).toBe('deployment-report-1234.pdf');
    expect(deploymentReportFilename()).toMatch(/^deployment-report-\d+\.pdf$/);
  });
});
