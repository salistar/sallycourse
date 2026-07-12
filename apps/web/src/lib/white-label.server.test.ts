import { describe, expect, it, vi } from 'vitest';
import { resolveWhiteLabelSite } from './white-label.server';

// `vi.mock` est hissé (hoist) en tête de fichier par vitest : le mock de
// @sallycourse/db et son spy `findOneMock` doivent donc être déclarés au
// niveau module (pas dans un describe) pour éviter une TDZ au hoisting.

const findOneMock = vi.fn();

vi.mock('@sallycourse/db', () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  SchoolBranding: {
    findOne: (...args: unknown[]) => ({
      lean: () => findOneMock(...args),
    }),
  },
}));

describe('resolveWhiteLabelSite', () => {
  it('retourne le site quand un SchoolBranding correspond au sous-domaine', async () => {
    findOneMock.mockResolvedValueOnce({
      userId: '507f1f77bcf86cd799439011',
      schoolName: 'École Atlas',
      logoUrl: 'branding/507f1f77bcf86cd799439011/logo.png',
      primaryColorHex: '#123456',
      accentColorHex: '#abcdef',
    });

    const site = await resolveWhiteLabelSite('academie-client');

    expect(site).toEqual({
      ownerId: '507f1f77bcf86cd799439011',
      schoolName: 'École Atlas',
      logoKey: 'branding/507f1f77bcf86cd799439011/logo.png',
      primaryColorHex: '#123456',
      accentColorHex: '#abcdef',
    });
  });

  it('retourne null quand aucun branding ne correspond', async () => {
    findOneMock.mockResolvedValueOnce(null);
    expect(await resolveWhiteLabelSite('inconnu')).toBeNull();
  });
});
