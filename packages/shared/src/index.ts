// @sallycourse/shared — types partagés, schémas Zod, constantes, utilitaires.
// Chaque domaine vit dans son fichier ; ce baril réexporte l'API publique.
// Les @ts-ignore ci-dessous neutralisent TS2835 quand ce fichier est consommé
// en source par le worker (tsconfig NodeNext) ; sans effet ici (Bundler) ni au runtime.
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './constants';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './schemas/course';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './schemas/lesson-content';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './schemas/screencast';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './schemas/master-archive';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './config';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './crypto';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './platform-credentials';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './storage';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './queues';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './admin-crons';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './udemy-compliance';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './lesson-delta';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './deploy-checklist';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './deploy-schedule';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './course-templates';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './llm-providers';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './generation-params';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './course-estimate';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './platform-constraints';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './pricing-table';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './school-branding';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './rag';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './fx-rates';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './errors';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './music-catalog';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './video-preview';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './off-peak-window';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './coupon';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './workspace-roles';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './marketplace';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './agency';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './audit';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './gamification';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './web-push';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './learning-path';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './blog';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './instructor';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './watermark';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './device-sessions';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './dmca';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './voice-intent';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './voice-recording';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './voice-catalog';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './theme-catalog';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './avatar-catalog';
