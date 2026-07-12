'use client';

import * as React from 'react';
import { Bot, Send, Sparkles } from 'lucide-react';
import { Button, Card, CardContent } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Widget chatbot embarquable (Prompt 146) — assistant de cours sur le LMS
 * interne. Composant AUTONOME (état local, un seul appel réseau par question,
 * aucune dépendance à l'arbre parent au-delà de courseId/lessonTitleById) :
 * il peut être extrait tel quel dans une page isolée si besoin d'intégration
 * externe future (Teachable/WordPress) via un simple <iframe
 * src="/embed/course-chatbot/[courseId]"> — il suffirait alors de créer cette
 * route qui rend uniquement <CourseChatbotWidget /> en pleine page, sans le
 * reste du LMS. Non fait ici (hors scope actuel, aucun besoin exprimé) mais
 * le composant est déjà conçu pour ce découpage.
 */

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sourceLessonIds?: string[];
}

export interface CourseChatbotWidgetProps {
  courseId: string;
  /** Titres des leçons par id — pour afficher le nom des sources citées. */
  lessonTitleById?: Record<string, string>;
  className?: string;
}

const MAX_QUESTION_LENGTH = 500;

export function CourseChatbotWidget({ courseId, lessonTitleById = {}, className }: CourseChatbotWidgetProps) {
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState('');
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleAsk() {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setQuestion('');
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/lms/courses/${courseId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string;
        sourceLessonIds?: string[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "L'assistant est momentanément indisponible.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer ?? '', sourceLessonIds: data.sourceLessonIds ?? [] },
      ]);
    } catch {
      setError('Connexion impossible — réessayez plus tard.');
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAsk();
    }
  }

  if (!open) {
    return (
      <div className={cn('fixed bottom-6 right-6 z-40', className)}>
        <Button onClick={() => setOpen(true)} className="shadow-lg" aria-label="Ouvrir l'assistant de cours">
          <Bot aria-hidden="true" />
          Assistant du cours
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('fixed bottom-6 right-6 z-40 w-[min(360px,calc(100vw-3rem))]', className)}>
      <Card className="flex max-h-[70vh] flex-col shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">Assistant du cours</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Fermer l'assistant">
            ✕
          </Button>
        </div>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="text-xs text-muted">
              Posez une question sur le contenu de ce cours — l'assistant répond à partir des leçons déjà disponibles
              et cite ses sources.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[90%] rounded-md px-3 py-2 text-sm',
                m.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'mr-auto bg-surface-subtle text-foreground',
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === 'assistant' && m.sourceLessonIds && m.sourceLessonIds.length > 0 && (
                <p className="mt-1.5 text-2xs text-muted">
                  Sources :{' '}
                  {m.sourceLessonIds.map((id) => lessonTitleById[id] ?? id).join(', ')}
                </p>
              )}
            </div>
          ))}
          {busy && <p className="text-xs text-muted">L'assistant réfléchit…</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
        </CardContent>

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
            onKeyDown={handleKeyDown}
            placeholder="Votre question sur ce cours…"
            rows={2}
            className={cn(
              'min-h-0 flex-1 resize-none rounded-sm border border-input bg-surface px-3 py-2',
              'text-sm text-foreground shadow-sm transition-colors duration-fast',
              'placeholder:text-muted hover:border-ring/50',
              'focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/35',
            )}
            aria-label="Votre question sur ce cours"
          />
          <Button onClick={handleAsk} disabled={busy || question.trim().length < 3} aria-label="Envoyer la question">
            <Send aria-hidden="true" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
