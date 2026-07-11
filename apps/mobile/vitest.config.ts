import { defineConfig } from 'vitest/config';

/**
 * Config vitest du package mobile — on ne teste QUE la logique pure du client
 * API (src/api/client.ts). Pas de rendu React Native réel (pas de jest-expo,
 * pas de RN Testing Library) : ce package reste un client HTTP testable en
 * environnement Node classique.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
