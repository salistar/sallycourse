import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENTS } from '@sallycourse/db';
import { buildSamplePayload } from './zapier-samples';

describe('buildSamplePayload', () => {
  it.each(WEBHOOK_EVENTS)('produit un exemple complet et cohérent pour %s', (event) => {
    const sample = buildSamplePayload(event);
    expect(sample.event).toBe(event);
    expect(typeof sample.timestamp).toBe('number');
    expect(sample.data).toBeTruthy();
    expect(typeof sample.data).toBe('object');
  });

  it('renvoie des données spécifiques par événement (pas un exemple générique partagé)', () => {
    const deployed = buildSamplePayload('deployed');
    const generationComplete = buildSamplePayload('generation_complete');
    expect(deployed.data).toHaveProperty('platform');
    expect(generationComplete.data).not.toHaveProperty('platform');
  });
});
