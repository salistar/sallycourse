'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Pencil, Save, X } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ArticleView } from '../article-view';
import { useDirtyState, confirmDiscardIfDirty } from './use-dirty-state';
import { useAutosave, autosaveStatusLabel } from '@/hooks/use-autosave';
import { clearLocalDraft, readLocalDraft, shouldOfferRecovery, writeLocalDraft } from '@/hooks/local-draft';
import { VersionHistoryPanel } from './version-history-panel';

/**
 * Éditeur d'article — textarea Markdown monospace à gauche, preview live
 * (ArticleView) à droite. Sauvegarde via PATCH /api/lessons/[id] ; la leçon
 * repasse en 'pending' côté serveur (assets dérivés invalidés) puis on
 * rafraîchit le Server Component. Autosave débouncée (P131) + brouillon
 * local de secours si la sauvegarde serveur échoue.
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
  const draftScope = `article:${lessonId}`;

  const [markdown, setMarkdown] = React.useState(() => {
    // Récupération d'un brouillon local si la dernière sauvegarde serveur
    // avait échoué (P131) : on ne propose que si le brouillon diffère du
    // contenu serveur reçu au chargement.
    const draft = readLocalDraft<string>(draftScope);
    if (draft && shouldOfferRecovery(draft, initialMarkdown)) {
      return draft.value;
    }
    return initialMarkdown;
  });
  const [recovered] = React.useState(() => {
    const draft = readLocalDraft<string>(draftScope);
    return Boolean(draft && shouldOfferRecovery(draft, initialMarkdown));
  });
  const [baseline, setBaseline] = React.useState(initialMarkdown);
  const [saving, setSaving] = React.useState(false);

  const dirty = useDirtyState(markdown, baseline);

  const persist = React.useCallback(
    async (value: string) => {
      const res = await fetch(`/api/lessons/${lessonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleMd: value }),
      });
      if (!res.ok) throw new Error('save-failed');
      setBaseline(value);
      clearLocalDraft(draftScope);
    },
    [lessonId, draftScope],
  );

  // Autosave : débounce 5s après la dernière frappe, uniquement si le
  // contenu diffère de la baseline (sinon rien à sauvegarder).
  const autosave = useAutosave(markdown, persist, { enabled: dirty });

  // Filet de sécurité : tant que dirty, on garde une copie locale à jour.
  // Si l'autosave serveur échoue, le brouillon local reste disponible au
  // rechargement (voir lecture initiale ci-dessus).
  React.useEffect(() => {
    if (dirty) writeLocalDraft(draftScope, markdown);
    else clearLocalDraft(draftScope);
  }, [dirty, markdown, draftScope]);

  const exit = () => {
    if (confirmDiscardIfDirty(dirty)) onExit();
  };

  const save = async () => {
    setSaving(true);
    try {
      await persist(markdown);
      toast({
        title: 'Article enregistré',
        description: 'Les captures dérivées seront régénérées à la prochaine production.',
        variant: 'success',
      });
      router.refresh();
    } catch {
      toast({
        title: 'Enregistrement impossible',
        description: 'Une erreur est survenue, réessayez plus tard. Votre brouillon reste sauvegardé localement.',
        variant: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };

  const autosaveLabel = autosaveStatusLabel(autosave.status, autosave.lastSavedAt);

  return (
    <div className="flex flex-col gap-4">
      {recovered && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Un brouillon non synchronisé a été retrouvé sur cet appareil et rechargé — pensez à
          l’enregistrer.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
          <Pencil className="size-3.5 text-primary" aria-hidden="true" />
          Édition de l’article
          {dirty && <span className="ms-1 text-accent-500 normal-case tracking-normal">• non enregistré</span>}
          {!dirty && autosaveLabel && (
            <span className="ms-1 text-muted normal-case tracking-normal">• {autosaveLabel}</span>
          )}
          {autosave.status === 'saving' && (
            <span className="ms-1 text-muted normal-case tracking-normal">• Enregistrement…</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <VersionHistoryPanel lessonId={lessonId} currentMarkdown={markdown} />
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
