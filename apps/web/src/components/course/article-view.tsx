'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@/lib/cn';

/**
 * Rendu Markdown d'une leçon article — GFM (tableaux, cases à cocher…) et
 * HTML assaini (rehype-sanitize) : le contenu vient d'une génération IA,
 * on ne lui fait pas confiance. Styles typographiques via sélecteurs
 * descendants, tokens sémantiques uniquement.
 */
export interface ArticleViewProps {
  markdown: string;
  className?: string;
}

export function ArticleView({ markdown, className }: ArticleViewProps) {
  return (
    <article
      className={cn(
        'max-w-none text-sm leading-relaxed text-foreground',
        // Titres — serif display, hiérarchie nette.
        '[&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-foreground',
        '[&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold',
        '[&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold',
        '[&_h4]:mt-4 [&_h4]:text-sm [&_h4]:font-semibold',
        // Corps de texte et listes.
        '[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:mt-1',
        '[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_strong]:font-semibold',
        '[&_hr]:my-6 [&_hr]:border-border',
        // Code inline et blocs.
        '[&_code]:rounded-sm [&_code]:bg-surface-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
        '[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface-subtle [&_pre]:p-4',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        // Citations et tableaux (GFM).
        '[&_blockquote]:mt-3 [&_blockquote]:border-s-2 [&_blockquote]:border-primary-400 [&_blockquote]:ps-4 [&_blockquote]:italic [&_blockquote]:text-muted',
        '[&_table]:mt-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
        '[&_th]:border [&_th]:border-border [&_th]:bg-surface-subtle [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-start [&_th]:font-semibold',
        '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5',
        '[&_img]:mt-3 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
