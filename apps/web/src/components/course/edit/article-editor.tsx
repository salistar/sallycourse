'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Pencil, Save, X } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ArticleView } from '../article-view';
import { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';

/**
 * Éditeur d'article — textarea Markdown monospace à gauche, preview live
 * (ArticleView) à droite. Sauvegarde via PATCH /api/lessons/[id] ; la leçon
 * repasse en 'pending' côté serveur (assets dérivés invalidés) puis on
 * rafraîchit le Server Component.
 */
export interface ArticleEditorProps {
  lessonId: string;
  /** Markdown initial (résolu côté serveur depuis le stockage objet). */
  initialMarkdown: string;
  /** Sortie du mode édition. */
  onExit: () => void;
}

export function ArticleEditor({ lessonId, initialMarkdown, onExit }: ArticleEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [markdown, setMarkdown] = React.useState(initialMarkdown);
  const [baseline, setBaseline] = React.useState(initialMarkdown);
  const [saving, setSaving] = React.useState(false);

  const dirty = useDirtyState(markdown, baseline);

  const exit = () => {
    if (confirmDiscardIfDirty(dirty)) onExit();
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleMd: markdown }),
      });
      if (res.ok) {
        setBaseline(markdown); // Baseline à jour : plus dirty.
        toast({
          title: 'Article enregistré',
          description: 'Les captures dérivées seront régénérées à la prochaine production.',
          variant: 'success',
        });
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Enregistrement impossible',
          description: data?.error ?? 'Une erreur est survenue, réessayez plus tard.',
          variant: 'danger',
        });
      }
    } catch {
      toast({
        title: 'Erreur réseau',
        description: 'Impossible de joindre le serveur, vérifiez votre connexion.',
        variant: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <Pencil className="size-3.5 text-primary" aria-hidden="true" />
          Édition de l’article
          {dirty && <span className="ms-1 text-accent-500 normal-case tracking-normal">• non enregistré</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exit}>
            <X aria-hidden="true" />
            Fermer
          </Button>
          <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
            {!saving && <Save aria-hidden="true" />}
            Enregistrer
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Éditeur Markdown brut */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor={`md-${lessonId}`}
            className="text-2xs font-semibold uppercase tracking-wide text-muted"
          >
            Markdown
          </label>
          <textarea
            id={`md-${lessonId}`}
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            spellCheck={false}
            className={cn(
              'min-h-[28rem] w-full resize-y rounded-md border border-input bg-surface p-4',
              'font-mono text-xs leading-relaxed text-foreground shadow-sm',
              'transition-colors duration-fast ease-standard',
              'hover:border-ring/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
            )}
          />
        </div>

        {/* Preview live */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
            <Eye className="size-3.5" aria-hidden="true" />
            Aperçu
          </p>
          <div className="min-h-[28rem] overflow-y-auto rounded-md border border-border bg-surface-subtle/40 p-4">
            {markdown.trim() ? (
              <ArticleView markdown={markdown} />
            ) : (
              <p className="text-sm text-muted">L’aperçu s’affichera ici dès que vous saisissez du Markdown.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
