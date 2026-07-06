import type { Config } from 'tailwindcss';
import animatePlugin from 'tailwindcss-animate';
import { salistarPreset } from '@sallycourse/design/tailwind';

// La palette et les tokens viennent du design system (@sallycourse/design) —
// aucune couleur définie ici en dur : tout passe par le preset SALISTAR.
const config: Config = {
  darkMode: 'class',
  presets: [salistarPreset as Partial<Config>],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/design/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      /*
       * Keyframes propres aux composants UI (aucune couleur ici — les
       * dégradés/teintes viennent des classes du preset SALISTAR).
       */
      keyframes: {
        /* Balayage lumineux des skeletons (voile en -translate-x-full au repos) */
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        /* Sheen continu des dégradés (barre de progression) */
        'gradient-pan': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '100% 50%' },
        },
        /* Barre de progression indéterminée */
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'gradient-pan': 'gradient-pan 2.5s ease-in-out infinite alternate',
        'progress-indeterminate': 'progress-indeterminate 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [animatePlugin],
};

export default config;
