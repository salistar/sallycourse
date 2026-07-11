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
export * from './udemy-compliance';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './lesson-delta';
// @ts-ignore TS2835 — import sans extension, résolu partout (Bundler/Next/tsx)
export * from './course-templates';
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
