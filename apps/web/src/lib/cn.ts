import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Fusionne des classes Tailwind conditionnelles (clsx) puis résout
 * les conflits d'utilitaires (tailwind-merge). À utiliser dans tous
 * les composants UI du design system.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
