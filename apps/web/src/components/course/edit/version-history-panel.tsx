'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { History, RotateCcw } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { diffLines, sortVersionsDesc, type LessonVersionSummary } from './version-history';
import { errorMessage } from '@/lib/error-message';

/**
 * Panneau « Historique » d'une leçon (P131) : liste des versions passées
 * (plus récente d'abord), diff Markdown simple contre le contenu actuel pour
 * les leçons articles, et bouton de restauration. Charge la liste à
 * l'ouverture (pas de fetch tant que le dialogue est fermé).
 */

interface RawVersion extends LessonVersionSummary {
  snapshot: unknown;
}

export interface VersionHistoryPanelProps {
  lessonId: string;
  /** Contenu actuel pour le diff (Markdown de l'article, sinon undefined). */
  currentMarkdown?: string;
  /** Appelé après une restauration réussie (ex. router.refresh() + onExit). */
  onRestored?: () => void;
}

export function VersionHistoryPanel({ lessonId, currentMarkdown, onRestored }: VersionHistoryPanelProps) {
  const router = useRouter();
  const t = useTranslations('course.editor');
  const tApiError = useTranslations('apiErrors');
  const format = useFormatter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [versions, setVersions] = React.useState<RawVersion[]>([]);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/versions`);
      if (res.ok) {
        const data = (await res.json()) as { versions: RawVersion[] };
        setVersions(sortVersionsDesc(data.versions));
      }
    } catch {
      // Silencieux : l'historique reste vide, pas bloquant pour l'édition.
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const restore = async (versionId: string) => {
    setRestoringId(versionId);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/versions/${versionId}/restore`, {
        method: 'POST',
      });
      if (res.ok) {
        toast({ title: t('history.restoredTitle'), description: t('history.restoredDesc'), variant: 'success' });
        setOpen(false);
        router.refresh();
        onRestored?.();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: t('history.restoreErrorTitle'),
          description: errorMessage(data, tApiError),
          variant: 'danger',
        });
      }
    } catch {
      toast({ title: t('networkError'), description: t('serverUnreachable'), variant: 'danger' });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <History aria-hidden="true" />
        {t('history.open')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('history.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('history.dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto">
            {loading && <p className="text-sm text-muted">{t('history.loading')}</p>}
            {!loading && versions.length === 0 && (
              <p className="text-sm text-muted">{t('history.empty')}</p>
            )}
            {versions.map((version) => {
              const expanded = expandedId === version.id;
              const snapshotMd =
                typeof (version.snapshot as { articleMd?: unknown } | null)?.articleMd === 'string'
                  ? (version.snapshot as { articleMd: string }).articleMd
                  : undefined;

              return (
                <div key={version.id} className="rounded-md border border-border bg-surface p-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {format.dateTime(new Date(version.createdAt), {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      {version.label && <p className="text-xs text-muted">{version.label}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {snapshotMd !== undefined && currentMarkdown !== undefined && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(expanded ? null : version.id)}
                        >
                          {expanded ? t('history.hideDiff') : t('history.showDiff')}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={restoringId === version.id}
                        onClick={() => restore(version.id)}
                      >
                        {restoringId !== version.id && <RotateCcw aria-hidden="true" />}
                        {t('history.restore')}
                      </Button>
                    </div>
                  </div>

                  {expanded && snapshotMd !== undefined && currentMarkdown !== undefined && (
                    <MarkdownDiff before={snapshotMd} after={currentMarkdown} />
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Rendu ligne à ligne du diff (vert = ajout, rouge = suppression). */
function MarkdownDiff({ before, after }: { before: string; after: string }) {
  const lines = React.useMemo(() => diffLines(before, after), [before, after]);
  return (
    <pre className="mt-3 max-h-64 overflow-auto rounded-sm border border-border bg-surface-subtle/40 p-3 text-2xs leading-relaxed">
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            'whitespace-pre-wrap',
            line.op === 'add' && 'bg-success/10 text-success',
            line.op === 'remove' && 'bg-danger/10 text-danger line-through',
          )}
        >
          {line.op === 'add' ? '+ ' : line.op === 'remove' ? '- ' : '  '}
          {line.text || ' '}
        </div>
      ))}
    </pre>
  );
}
