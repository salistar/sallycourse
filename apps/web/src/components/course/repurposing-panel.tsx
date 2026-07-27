import { BookOpen, Clapperboard, Layers, Podcast } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import type { RepurposingView } from './types';

/**
 * Section « Réutilisation du contenu » (P197/201/202/203) : liens de
 * téléchargement des sorties dérivées du cours (flashcards + Anki, podcast/RSS,
 * ebook EPUB/PDF, bande-annonce). Masquée tant que rien n'a été généré.
 */
export function RepurposingPanel({ repurposing }: { repurposing?: RepurposingView | null }) {
  if (!repurposing || Object.keys(repurposing).length === 0) return null;

  const link = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/50 hover:text-primary"
    >
      {label}
    </a>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Layers className="size-5 text-accent" aria-hidden="true" />
          Réutilisation du contenu
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {repurposing.flashcards && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm text-foreground">
              <Layers className="size-4 text-muted" aria-hidden="true" />
              {repurposing.flashcards.count} flashcards
            </span>
            {repurposing.flashcards.ankiUrl && link(repurposing.flashcards.ankiUrl, 'Export Anki')}
            {repurposing.flashcards.jsonUrl && link(repurposing.flashcards.jsonUrl, 'JSON')}
          </div>
        )}
        {repurposing.podcast && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm text-foreground">
                <Podcast className="size-4 text-muted" aria-hidden="true" />
                Podcast — {repurposing.podcast.count} épisode(s)
              </span>
              {repurposing.podcast.feedUrl && link(repurposing.podcast.feedUrl, 'Flux RSS')}
            </div>
            {repurposing.podcast.episodes && repurposing.podcast.episodes.length > 0 && (
              <ul className="flex list-none flex-col gap-2 p-0">
                {repurposing.podcast.episodes.map((ep, i) => (
                  <li key={ep.url} className="flex flex-col gap-1 rounded-sm border border-border bg-surface p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-foreground">
                        Épisode {i + 1} — {ep.title}
                      </span>
                      {link(ep.url, 'Télécharger')}
                    </div>
                    <audio controls preload="none" src={ep.url} className="h-8 w-full">
                      <track kind="captions" />
                    </audio>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {repurposing.ebook && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm text-foreground">
              <BookOpen className="size-4 text-muted" aria-hidden="true" />
              Ebook
            </span>
            {repurposing.ebook.epubUrl && link(repurposing.ebook.epubUrl, 'EPUB')}
            {repurposing.ebook.pdfUrl && link(repurposing.ebook.pdfUrl, 'PDF')}
          </div>
        )}
        {repurposing.trailer?.videoUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm text-foreground">
              <Clapperboard className="size-4 text-muted" aria-hidden="true" />
              Bande-annonce
            </span>
            {link(repurposing.trailer.videoUrl, 'Voir / télécharger')}
          </div>
        )}
        <p className="text-2xs text-muted">
          Sorties dérivées générées automatiquement du cours (révision espacée, audio, ebook, promo).
        </p>
      </CardContent>
    </Card>
  );
}
