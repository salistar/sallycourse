'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { transitions } from '@/components/motion';
import { cn } from '@/lib/cn';

/**
 * Accordéon FAQ réutilisable — un seul panneau ouvert à la fois.
 * Composant générique (indépendant du contenu marketing) pour pouvoir
 * être réemployé ailleurs (aide, onboarding…).
 */
export interface AccordionItemData {
  question: string;
  answer: string;
}

export interface AccordionProps {
  items: AccordionItemData[];
  className?: string;
}

export function Accordion({ items, className }: AccordionProps) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(0);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `accordion-panel-${index}`;
        const buttonId = `accordion-button-${index}`;
        return (
          <div
            key={item.question}
            className="overflow-hidden rounded-md border border-border bg-surface"
          >
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className={cn(
                  'flex w-full items-center justify-between gap-4 px-5 py-4 text-start',
                  'text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-subtle/60',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <span>{item.question}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'size-4 shrink-0 text-muted transition-transform duration-base ease-standard',
                    isOpen && 'rotate-180 text-accent',
                  )}
                />
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={transitions.springSnappy}
                  className="overflow-hidden"
                >
                  <p className="px-5 pb-4 text-sm leading-relaxed text-muted">{item.answer}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
