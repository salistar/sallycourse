// Tests purs du SVG de repli Mermaid (Prompt 83) — SANS la dépendance
// `mermaid` (non installée, cf. depsNeeded). Vérifie que le repli produit
// toujours un SVG valide (jamais d'exception) à partir du parseur maison.
import { describe, expect, it } from 'vitest';
import { renderMermaidFallbackSvg } from './mermaid-fallback.js';

describe('renderMermaidFallbackSvg', () => {
  it('génère un SVG avec un nœud par élément du graphe', () => {
    const svg = renderMermaidFallbackSvg('flowchart TD\nA[Début] --> B[Fin]');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Début');
    expect(svg).toContain('Fin');
    // Deux rectangles de nœud + le marqueur de flèche (defs)
    expect(svg.match(/<rect/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('inclut le libellé porté par une flèche', () => {
    const svg = renderMermaidFallbackSvg('flowchart TD\nA[Test] -->|oui| B[Suite]');
    expect(svg).toContain('oui');
  });

  it('échappe le texte des libellés (pas d\'injection HTML brute)', () => {
    const svg = renderMermaidFallbackSvg('flowchart TD\nA[<script>] --> B[Fin]');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('gère un texte sans lien reconnu sans jeter (schéma vide)', () => {
    const svg = renderMermaidFallbackSvg('ceci n\'est pas du mermaid');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('schéma vide');
  });

  it('gère une source vide sans jeter', () => {
    expect(() => renderMermaidFallbackSvg('')).not.toThrow();
  });

  it('découpe les libellés longs sur plusieurs lignes de tspan', () => {
    const longLabel = 'Un libellé assez long pour forcer un retour à la ligne automatique';
    const svg = renderMermaidFallbackSvg(`flowchart TD\nA[${longLabel}] --> B[Fin]`);
    expect(svg.match(/<tspan/g)?.length).toBeGreaterThan(1);
  });

  it('reste déterministe (deux appels identiques produisent le même SVG)', () => {
    const source = 'flowchart TD\nA --> B\nB --> C';
    expect(renderMermaidFallbackSvg(source)).toBe(renderMermaidFallbackSvg(source));
  });
});
