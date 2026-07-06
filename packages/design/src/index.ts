// @sallycourse/design — design system SALISTAR : tokens, preset Tailwind,
// générateur de CSS variables. Export JSON statique : ./tokens.json.
// Auto-références du paquet (pas d'imports relatifs extensionless : './tokens'
// entrerait en collision avec tokens.json selon le résolveur utilisé).
export * from '@sallycourse/design/tokens';
export * from '@sallycourse/design/css-variables';
export { salistarPreset, type SalistarPreset } from '@sallycourse/design/tailwind';
