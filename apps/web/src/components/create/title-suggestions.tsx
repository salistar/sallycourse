'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Pilules de suggestions de titres — apparaissent sous la frappe (debounce géré
 * par le parent) avec une entrée en cascade, disparaissent en fondu.
 */
export interface TitleSuggestionsProps {
  suggestions: string[];
  onPick: (suggestion: string) => void;
}

export function TitleSuggestions({ suggestions, onPick }: TitleSuggestionsProps) {
  return (
    <div className="min-h-24 w-full" aria-live="polite">
      <AnimatePresence mode="wait">
        {suggestions.length > 0 && (
          <motion.div
            key={suggestions.join('|')}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex flex-col items-center gap-3"
          >
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-muted">
              <Sparkles className="h-3 w-3 text-accent-400" aria-hidden="true" />
              Suggestions
            </p>
            <ul className="flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion, index) => (
                <motion.li
                  key={suggestion}
                  initial={{ opacity: 0, y: 10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: index * 0.07, duration: 0.3, ease: 'easeOut' }}
                >
                  <button
                    type="button"
                    onClick={() => onPick(suggestion)}
                    className={cn(
                      'max-w-xs truncate rounded-full border border-border bg-surface px-4 py-2 text-sm text-muted sm:max-w-md',
                      'transition-all duration-fast ease-standard',
                      'hover:border-ring/60 hover:bg-primary-soft hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                      'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'active:scale-[0.98]',
                    )}
                  >
                    {suggestion}
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
