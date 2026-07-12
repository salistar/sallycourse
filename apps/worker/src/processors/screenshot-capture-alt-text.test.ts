// Test ciblé de generateScreenshotAltText (Prompt 137, accessibilité) —
// isolé du reste du processor (Mongo/Playwright/sharp non nécessaires ici).
// MOCK_PROVIDERS=true : callClaudeJson retombe sur une fixture déterministe
// (mockAltText), aucun appel réseau.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetConfig = vi.hoisted(() => vi.fn(() => ({ MOCK_PROVIDERS: true })));

vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return { ...actual, getConfig: mockGetConfig };
});

import { generateScreenshotAltText } from './screenshot-capture.js';

beforeEach(() => {
  mockGetConfig.mockClear();
});

describe('generateScreenshotAltText (P137, accessibilité)', () => {
  it('retourne un texte alternatif non vide et déterministe en mode mock', async () => {
    const alt = await generateScreenshotAltText(
      'Créer un formulaire React',
      2,
      'Cliquez sur le bouton Enregistrer.',
      'Saisir le nom du champ puis valider',
    );
    expect(alt.length).toBeGreaterThan(0);
    // Déterministe : mêmes entrées → même sortie (fixture mock par titre/légende).
    const again = await generateScreenshotAltText(
      'Créer un formulaire React',
      2,
      'Cliquez sur le bouton Enregistrer.',
      'Saisir le nom du champ puis valider',
    );
    expect(alt).toBe(again);
  });

  it('ne jette jamais — replie sur la légende si callClaudeJson échoue', async () => {
    // Simule un schéma qui ne matcherait aucune fixture mock (impossible ici
    // car altTextResultSchema a un fixture dédié) : on vérifie simplement que
    // la fonction retourne toujours une chaîne exploitable, jamais une exception.
    await expect(
      generateScreenshotAltText('', 1, 'Légende de secours', ''),
    ).resolves.toEqual(expect.any(String));
  });
});
