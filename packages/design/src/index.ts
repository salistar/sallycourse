// @sallycourse/design — design system SALISTAR : tokens, preset Tailwind,
// générateur de CSS variables. Export JSON statique : ./tokens.json.
// Auto-références du paquet (pas d'imports relatifs extensionless : './tokens'
// entrerait en collision avec tokens.json selon le résolveur utilisé).
export * from '@sallycourse/design/tokens';
export * from '@sallycourse/design/css-variables';
export { salistarPreset, type SalistarPreset } from '@sallycourse/design/tailwind';
export * from '@sallycourse/design/video-motion';
// Annotation éditoriale des captures d'écran (overlay SVG composé via sharp).
export * from '@sallycourse/design/annotations';
// Visuels marketing générés (cover Udemy, miniature YouTube, OG, story).
export * from '@sallycourse/design/marketing-assets';
// Gabarits de slides vidéo (Node uniquement : lit render-templates/*.html sur disque).
export * from '@sallycourse/design/render-templates';
// Gabarits de documents PDF print (Node uniquement : lit pdf-templates/*.html sur disque).
export * from '@sallycourse/design/pdf-templates';
