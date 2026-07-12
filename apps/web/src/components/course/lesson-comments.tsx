'use client';

import * as React from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { Button, Textarea, useToast } from '@/components/ui';

/**
 * Commentaires d'équipe sur une leçon (Prompt 138) — liste + formulaire
 * simple. N'est monté que si le cours appartient à un Workspace (visible
 * uniquement en contexte équipe, cf. LessonPanel). Charge le fil au montage
 * et à chaque changement de leçon.
 */

interface CommentDto {
  id: string;
  userId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface LessonCommentsProps {
  lessonId: string;
}

export function LessonComments({ lessonId }: LessonCommentsProps) {
  const { toast } = useToast();
  const [comments, setComments] = React.useState<CommentDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [text, setText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/comments`);
      if (res.ok) {
        const data = (await res.json()) as { comments: CommentDto[] };
        setComments(data.comments);
      }
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.ok) {
        const created = (await res.json()) as CommentDto;
        setComments((prev) => [...prev, created]);
        setText('');
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({
          title: 'Envoi impossible',
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
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <MessageCircle className="size-4 text-muted" aria-hidden="true" />
        Commentaires d'équipe
      </h3>

      {loading ? (
        <p className="mt-3 text-sm text-muted">Chargement…</p>
      ) : comments.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Aucun commentaire pour l'instant.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border bg-surface-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">{c.authorName}</span>
                <span className="text-2xs text-muted">
                  {new Date(c.createdAt).toLocaleString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{c.text}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          label="Commentaire"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ajouter un commentaire pour l'équipe…"
          rows={2}
          className="flex-1"
        />
        <Button size="sm" onClick={submit} loading={submitting} disabled={!text.trim()}>
          {!submitting && <Send aria-hidden="true" />}
          Envoyer
        </Button>
      </div>
    </section>
  );
}
