import type { Config } from 'tailwindcss';

// La palette et les tokens viennent du design system (Prompt D1) —
// aucune couleur définie ici en dur.
const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
