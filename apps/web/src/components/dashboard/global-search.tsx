'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, FileText, Layers, Search } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui';
import { highlightMatches, type SearchResultGroup, type SearchResultItem } from '@/lib/search';
import { cn } from '@/lib/cn';
import { useTranslations } from 'next-intl';

/**
 * Recherche globale du dashboard (P132) — modal ouvrable via Cmd/Ctrl+K,
 * interroge GET /api/search (index texte MongoDB natif, cross-collection
 * Course/Section/Lesson scopée à l'utilisateur). Navigation clavier
 * (flèches + Entrée), surlignage simple du terme trouvé.
 */

interface SearchResponse {
  query: string;
  groups: SearchResultGroup[];
}

/** Icône par type de résultat. */
const KIND_ICON: Record<SearchResultItem['kind'], React.ComponentType<{ className?: string }>> = {
  course: BookOpen,
  section: Layers,
  lesson: FileText,
};

const KIND_LABEL: Record<SearchResultItem['kind'], string> = {
  course: 'kind.course',
  section: 'kind.section',
  lesson: 'kind.lesson',
};

/**
 * Verrou module-level : plusieurs <GlobalSearch> peuvent être montés en même
 * temps (sidebar desktop cachée en CSS + tiroir mobile + icône header mobile).
 * Seule la première instance montée répond au raccourci Cmd/Ctrl+K, pour
 * éviter d'ouvrir plusieurs modals superposées.
 */
let shortcutOwnerId: symbol | null = null;

/** Applatit les groupes en une liste ordonnée d'items navigables au clavier. */
function flattenGroups(groups: SearchResultGroup[]): Array<SearchResultItem & { courseTitle: string }> {
  return groups.flatMap((group) => group.items.map((item) => ({ ...item, courseTitle: group.courseTitle })));
}

/** Texte surligné via des <mark> — s'appuie sur la logique pure de lib/search. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const segments = highlightMatches(text, query);
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-[2px] bg-accent-400/30 text-foreground">
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </>
  );
}

export interface GlobalSearchProps {
  /** Affiche uniquement l'icône (barre haute mobile) au lieu de la pilule complète. */
  iconOnly?: boolean;
}

export function GlobalSearch({ iconOnly = false }: GlobalSearchProps) {
  const router = useRouter();
  const t = useTranslations('dashboard.search');
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [groups, setGroups] = React.useState<SearchResultGroup[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const instanceId = React.useRef(Symbol('global-search-instance'));

  // Une seule instance « possède » le raccourci clavier à la fois (voir
  // shortcutOwnerId) — la première montée le devient, les autres se taisent.
  React.useEffect(() => {
    if (shortcutOwnerId === null) shortcutOwnerId = instanceId.current;
    return () => {
      if (shortcutOwnerId === instanceId.current) shortcutOwnerId = null;
    };
  }, []);

  // Raccourci global Cmd/Ctrl+K — ouvre la modal depuis n'importe où dans le dashboard.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutOwnerId !== instanceId.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus sur le champ à l'ouverture.
  React.useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    // Reset à la fermeture (état propre à la prochaine ouverture).
    setQuery('');
    setGroups([]);
    setActiveIndex(0);
  }, [open]);

  // Recherche débouncée dès 2 caractères.
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setGroups([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as SearchResponse;
        setGroups(data.groups);
        setActiveIndex(0);
      } catch {
        // Silencieux : la recherche ne doit jamais casser le dashboard.
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const flatItems = React.useMemo(() => flattenGroups(groups), [groups]);

  const navigateTo = React.useCallback(
    (item: SearchResultItem) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flatItems.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = flatItems[activeIndex];
      if (item) navigateTo(item);
    }
  };

  return (
    <>
      {/* Déclencheur — icône seule (mobile) ou pilule discrète style « recherche macOS » */}
      {iconOnly ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('triggerAriaLabel')}
          className="flex h-10 w-10 items-center justify-center rounded-sm text-muted transition-colors duration-fast hover:bg-primary-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80"
        >
          <Search className="size-5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('triggerAriaLabel')}
          className={cn(
            'flex items-center gap-2 rounded-md border border-border bg-surface-subtle/60 px-3 py-2 text-sm text-muted',
            'transition-colors duration-fast hover:border-ring/50 hover:bg-surface-subtle hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{t('placeholderShort')}</span>
          <kbd className="ms-1 hidden items-center gap-0.5 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-2xs font-medium text-muted sm:flex">
            Ctrl K
          </kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent hideClose className="max-w-xl p-0" aria-label={t('triggerAriaLabel')}>
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('searchPlaceholder')}
              aria-label={t('inputAriaLabel')}
              role="combobox"
              aria-expanded={flatItems.length > 0}
              aria-controls="global-search-results"
              autoComplete="off"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
            />
          </div>

          <div id="global-search-results" role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
            {query.trim().length < 2 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">
                {t('minChars')}
              </p>
            ) : loading && groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">{t('searching')}</p>
            ) : groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">{t('noResults', { query })}</p>
            ) : (
              groups.map((group) => (
                <div key={group.courseId} className="mb-2 last:mb-0">
                  <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
                    {group.courseTitle}
                  </p>
                  {group.items.map((item) => {
                    const flatIndex = flatItems.findIndex((f) => f.kind === item.kind && f.id === item.id);
                    const active = flatIndex === activeIndex;
                    const Icon = KIND_ICON[item.kind];
                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => navigateTo(item)}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-sm px-3 py-2 text-start text-sm',
                          'transition-colors duration-fast',
                          active ? 'bg-primary-soft text-foreground' : 'text-muted hover:bg-primary-soft/60',
                        )}
                      >
                        <Icon className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            <Highlighted text={item.title} query={query} />
                          </span>
                          {item.excerpt && (
                            <span className="mt-0.5 block truncate text-2xs text-muted">
                              <Highlighted text={item.excerpt} query={query} />
                            </span>
                          )}
                          <span className="mt-0.5 block text-2xs text-muted/70">{t(KIND_LABEL[item.kind])}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
