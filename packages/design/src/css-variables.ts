/**
 * @sallycourse/design — css-variables.ts
 * Générateur de CSS variables à partir des thèmes sémantiques (tokens.ts).
 * Les variables sont émises en canaux RGB ("R G B") afin que Tailwind
 * puisse composer l'opacité : `rgb(var(--sc-primary) / <alpha-value>)`.
 * Le résultat est injecté statiquement dans apps/web/src/app/globals.css.
 */

// Auto-référence du paquet : évite la collision de résolution avec tokens.json.
import { themes, type SemanticTheme } from '@sallycourse/design/tokens';

/** Préfixe commun des variables SallyCourse. */
export const CSS_VAR_PREFIX = 'sc';

/** Convertit `#RRGGBB` en canaux RGB "R G B" (sans rgb()). */
export function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** camelCase → kebab-case (mutedForeground → muted-foreground). */
function toKebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Nom complet d'une variable CSS pour une clé de thème. */
export function cssVarName(key: keyof SemanticTheme): string {
  return `--${CSS_VAR_PREFIX}-${toKebab(String(key))}`;
}

/**
 * Génère les déclarations d'un thème, une variable par ligne.
 * @param theme  valeurs sémantiques résolues (light ou dark)
 * @param indent indentation de chaque ligne
 */
export function themeToCssDeclarations(theme: SemanticTheme, indent = '  '): string {
  return (Object.entries(theme) as Array<[keyof SemanticTheme, string]>)
    .map(([key, hex]) => `${indent}${cssVarName(key)}: ${hexToRgbChannels(hex)};`)
    .join('\n');
}

/**
 * Génère le bloc CSS complet : `:root` = light, `.dark` = surcharge sombre
 * (le dark est appliqué par défaut via la classe sur <html>).
 */
export function generateCssVariables(): string {
  return [
    ':root {',
    themeToCssDeclarations(themes.light),
    '}',
    '',
    '.dark {',
    themeToCssDeclarations(themes.dark),
    '}',
  ].join('\n');
}

/** Chaîne CSS pré-générée, prête à être copiée dans un fichier .css. */
export const cssVariables: string = generateCssVariables();
