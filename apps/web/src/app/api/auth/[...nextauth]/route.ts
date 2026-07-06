import { handlers } from '@/lib/auth';

// Endpoints Auth.js (signin/signout/callback/session…) — runtime Node requis
// (Mongoose + bcrypt dans la config complète).
export const { GET, POST } = handlers;
