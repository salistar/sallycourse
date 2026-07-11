// Rendu SVG d'un schéma Mermaid pour le gabarit "diagram" (Prompt 83).
//
// La dépendance `mermaid` n'est PAS installée dans le worker (depsNeeded).
// Ce module fournit donc TOUJOURS un rendu, en deux voies :
//   1. si `mermaid` est présent dans node_modules (import dynamique), on
//      pourrait déléguer le rendu à sa CLI/lib — non branché ici tant que la
//      dépendance n'est pas ajoutée (voir renderMermaidSvg ci-dessous, qui
//      documente le point d'extension) ;
//   2. à défaut (cas actuel), un schéma de repli maison : les nœuds/arêtes
//      sont parsés depuis le texte Mermoid (parseMermaidFlowchart, pur,
//      @sallycourse/shared) puis disposés en colonnes verticales reliées par
//      des flèches SVG. Aucune mise en page automatique façon dagre — une
//      dégradation assumée et documentée, jamais un crash.
//
// Le SVG produit est injecté BRUT dans {{diagramHtml}} du gabarit "diagram"
// (packages/design/render-templates/diagram.html) : il doit donc utiliser
// des couleurs fixes (pas de var() : le gabarit n'injecte pas de <style>
// scoped pour un SVG externe) alignées sur packages/design/src/tokens.json.

import { parseMermaidFlowchart, colors, type ParsedMermaidGraph, type MermaidNode } from '../shared.js';

/** Couleurs figées depuis les tokens (P113 : plus de hex en dur) — le SVG de repli ne peut pas lire les CSS vars du gabarit hôte. */
const FALLBACK_COLORS = {
  nodeFill: colors.neutral[900],
  nodeStroke: colors.violet[500],
  nodeText: colors.neutral[100],
  edge: colors.violet[400],
  edgeLabel: colors.gold[400],
  edgeLabelBg: colors.neutral[950],
} as const;

/** Échappe un texte pour insertion sûre dans un attribut/texte SVG. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Découpe un libellé trop long sur plusieurs lignes (repli simple, pas de mesure réelle du texte). */
function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [label];
}

const NODE_WIDTH = 340;
const NODE_HEIGHT = 84;
const NODE_GAP_Y = 56;
const MARGIN = 40;

/**
 * Dispose un graphe parsé en une seule colonne verticale (ordre d'apparition
 * des nœuds dans le texte source) reliée par des flèches descendantes.
 * Suffisant pour les flowcharts linéaires/simples que produit un LLM en
 * contexte pédagogique (5-8 étapes) ; les graphes très ramifiés seront
 * simplement rendus dans l'ordre de première mention, sans respecter les
 * embranchements — dégradation assumée en l'absence de mermaid.js.
 */
function layoutGraph(graph: ParsedMermaidGraph): {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const positions = new Map<string, { x: number; y: number }>();
  const x = MARGIN;
  let y = MARGIN;
  for (const node of graph.nodes) {
    positions.set(node.id, { x, y });
    y += NODE_HEIGHT + NODE_GAP_Y;
  }
  const width = x + NODE_WIDTH + MARGIN;
  const height = Math.max(y - NODE_GAP_Y + MARGIN, MARGIN + NODE_HEIGHT + MARGIN);
  return { positions, width, height };
}

function nodeSvg(node: MermaidNode, pos: { x: number; y: number }): string {
  const lines = wrapLabel(node.label, 28).slice(0, 3);
  const lineHeight = 26;
  const startY = pos.y + NODE_HEIGHT / 2 - ((lines.length - 1) * lineHeight) / 2 + 8;
  const textSpans = lines
    .map(
      (line, i) =>
        `<tspan x="${pos.x + NODE_WIDTH / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('');
  return (
    `<rect x="${pos.x}" y="${pos.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="16" ` +
    `fill="${FALLBACK_COLORS.nodeFill}" stroke="${FALLBACK_COLORS.nodeStroke}" stroke-width="2"/>` +
    `<text text-anchor="middle" font-family="Figtree, sans-serif" font-size="22" font-weight="600" ` +
    `fill="${FALLBACK_COLORS.nodeText}">${textSpans}</text>`
  );
}

function edgeSvg(
  from: { x: number; y: number },
  to: { x: number; y: number },
  label: string | undefined,
): string {
  const startX = from.x + NODE_WIDTH / 2;
  const startY = from.y + NODE_HEIGHT;
  const endX = to.x + NODE_WIDTH / 2;
  const endY = to.y;
  const midY = (startY + endY) / 2;
  const labelSvg = label
    ? `<rect x="${startX - 60}" y="${midY - 16}" width="120" height="28" rx="6" fill="${FALLBACK_COLORS.edgeLabelBg}"/>` +
      `<text x="${startX}" y="${midY + 4}" text-anchor="middle" font-family="Figtree, sans-serif" ` +
      `font-size="18" fill="${FALLBACK_COLORS.edgeLabel}">${escapeXml(label)}</text>`
    : '';
  return (
    `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY - 10}" ` +
    `stroke="${FALLBACK_COLORS.edge}" stroke-width="2.5" marker-end="url(#sc-arrow)"/>` +
    labelSvg
  );
}

/**
 * Génère un SVG de repli à partir d'un texte Mermoid, SANS la dépendance
 * `mermaid` (dagre/d3 non installés). Toujours déterministe et sans réseau.
 * Retourne un SVG minimal ("(schéma vide)") si le texte ne contient aucun
 * lien reconnu — jamais d'exception.
 */
export function renderMermaidFallbackSvg(mermaidSource: string): string {
  const graph = parseMermaidFlowchart(mermaidSource);
  if (graph.nodes.length === 0) {
    return (
      '<svg viewBox="0 0 400 120" xmlns="http://www.w3.org/2000/svg">' +
      `<text x="200" y="60" text-anchor="middle" font-family="Figtree, sans-serif" ` +
      `font-size="24" fill="${FALLBACK_COLORS.nodeText}">(schéma vide)</text></svg>`
    );
  }

  const { positions, width, height } = layoutGraph(graph);

  const defs =
    '<defs><marker id="sc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    `<path d="M0 0 L10 5 L0 10 z" fill="${FALLBACK_COLORS.edge}"/></marker></defs>`;

  const nodesSvg = graph.nodes
    .map((node) => {
      const pos = positions.get(node.id);
      return pos ? nodeSvg(node, pos) : '';
    })
    .join('');

  const edgesSvg = graph.edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return '';
      return edgeSvg(from, to, edge.label);
    })
    .join('');

  return (
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" ` +
    `font-family="Figtree, sans-serif">${defs}${edgesSvg}${nodesSvg}</svg>`
  );
}

/**
 * Point d'extension : si `mermaid` est un jour ajouté aux dépendances du
 * worker (voir depsNeeded), c'est ICI qu'il faudrait brancher son rendu SSR
 * (mermaid.render côté Node nécessite un DOM — typiquement via la même page
 * Playwright déjà utilisée pour les slides, en chargeant mermaid.min.js et en
 * lisant le SVG produit). Tant que la dépendance est absente, on retombe
 * systématiquement sur `renderMermaidFallbackSvg`.
 */
export async function renderMermaidSvg(mermaidSource: string): Promise<string> {
  try {
    // Import dynamique : si le paquet n'est pas installé, l'échec est
    // silencieux et on retombe sur le repli — jamais de crash du pipeline.
    // @ts-expect-error — dépendance optionnelle non installée (depsNeeded : 'mermaid')
    const mermaidModule = await import('mermaid').catch(() => null);
    if (!mermaidModule) return renderMermaidFallbackSvg(mermaidSource);
    // Non implémenté tant que la dépendance n'est pas ajoutée au monorepo :
    // mermaid.js nécessite un contexte DOM pour son rendu SSR, ce qui exige
    // une intégration Playwright dédiée (page distincte, script injecté).
    return renderMermaidFallbackSvg(mermaidSource);
  } catch {
    return renderMermaidFallbackSvg(mermaidSource);
  }
}
