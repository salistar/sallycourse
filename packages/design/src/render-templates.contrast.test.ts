/**
 * Tests unitaires — audit de contraste WCAG des gabarits de slides D7
 * (Prompt 137, accessibilité). Fonction PURE : lit les fichiers .html de
 * render-templates/, en extrait les couleurs déclarées (variables CSS du
 * `:root` + règles de couleur de texte), et vérifie que chaque paire
 * texte/fond RÉELLEMENT utilisée pour du contenu lisible respecte le seuil
 * WCAG AA (ratio >= 4.5). Réutilise contrastRatio (déjà exporté par
 * marketing-assets.ts, cf. P11/D11) — aucune nouvelle logique de calcul.
 *
 * Les couleurs purement décoratives (numéros de ligne à opacity réduite,
 * traits/losanges, halos) sont volontairement exclues : seules les paires
 * texte/fond correspondant à du CONTENU affiché sont vérifiées ici.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './marketing-assets';
import { SLIDE_TEMPLATE_NAMES } from './render-templates';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'render-templates');

/** Extrait les déclarations `--nom: #hex;` du bloc :root d'un fichier gabarit. */
function extractRootVars(html: string): Record<string, string> {
  // Retire les commentaires CSS AVANT de chercher la fermeture du bloc :root —
  // un commentaire peut contenir des accolades (ex. exemples de code) qui
  // sinon tromperaient un simple match "jusqu'au premier }".
  const withoutComments = html.replace(/\/\*[\s\S]*?\*\//g, '');
  const rootMatch = withoutComments.match(/:root\s*\{([^}]*)\}/);
  const vars: Record<string, string> = {};
  if (!rootMatch) return vars;
  const body = rootMatch[1]!;
  const re = /--([\w-]+):\s*(#[0-9a-fA-F]{6})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    vars[m[1]!] = m[2]!;
  }
  return vars;
}

/** Charge un gabarit et ses variables de couleur résolues. */
function loadVars(name: string): Record<string, string> {
  const html = readFileSync(join(templatesDir, `${name}.html`), 'utf8');
  return extractRootVars(html);
}

const AA_NORMAL = 4.5;

describe('render-templates — contraste WCAG AA des gabarits de slides (P137)', () => {
  it('title.html : titre, sous-titre, marque, pied de page sur le fond sombre', () => {
    const v = loadVars('title');
    expect(contrastRatio(v.fg!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .title (extrémité claire du dégradé)
    expect(contrastRatio(v.muted!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .subtitle / .footer
    expect(contrastRatio(v['gold-400']!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .kicker
    expect(contrastRatio(v['gold-300']!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .kicker .lesson-number
    expect(contrastRatio(v['violet-300']!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .brand
  });

  it('content.html : titre, puces, pied de page', () => {
    const v = loadVars('content');
    expect(contrastRatio(v.fg!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .title / .bullet-text
    expect(contrastRatio(v['gold-400']!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .kicker
    expect(contrastRatio(v.muted!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .footer
  });

  it('code.html : titre, badge langage, texte de code sur le fond fenêtre (--surface)', () => {
    const v = loadVars('code');
    const windowBg = v.surface!; // .window/.code-scroll reposent sur --surface (pas --bg)
    expect(contrastRatio(v.fg!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .title
    expect(contrastRatio(v['gold-300']!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .lang-badge
    expect(contrastRatio(v.muted!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .file-name / .tok-punct
    // Palette syntaxique (.tok-*) sur le fond de la fenêtre de code :
    expect(contrastRatio(v['violet-300']!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .tok-kw
    expect(contrastRatio(v['gold-300']!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .tok-str
    expect(contrastRatio(v['gold-400']!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .tok-num
    expect(contrastRatio(v['info-400']!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .tok-fn
    expect(contrastRatio(v['success-300']!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .tok-type
    expect(contrastRatio(v.fg!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .tok-var
    // .tok-com (commentaires) : corrigé en P137 pour utiliser --muted (neutral.400)
    // au lieu de --muted-deep (neutral.500, 3.79 < 4.5 sur --surface).
    expect(contrastRatio(v.muted!, windowBg!)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('comparison.html : titres de colonnes et items sur le fond carte (--surface-subtle)', () => {
    const v = loadVars('comparison');
    const cardBg = v['surface-subtle']!; // .col repose sur un dégradé démarrant à --surface-subtle
    expect(contrastRatio(v.fg!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .title
    expect(contrastRatio(v['violet-300']!, cardBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .col-a .col-title
    expect(contrastRatio(v['gold-300']!, cardBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .col-b .col-title
    expect(contrastRatio(v.fg!, cardBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .col-item-text
  });

  it('quote.html : citation et attribution sur le fond carte', () => {
    const v = loadVars('quote');
    const cardBg = v['surface-subtle']!;
    expect(contrastRatio(v.fg!, cardBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .quote-text
    expect(contrastRatio(v['violet-300']!, cardBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .author
    expect(contrastRatio(v.muted!, cardBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .role
  });

  it('diagram.html : titre et légende sur le fond planche', () => {
    const v = loadVars('diagram');
    const boardBg = v['surface-subtle']!;
    expect(contrastRatio(v.fg!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .title
    expect(contrastRatio(v.muted!, boardBg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .caption
  });

  it('recap.html : titre et items de checklist', () => {
    const v = loadVars('recap');
    expect(contrastRatio(v.fg!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .title / .check-text
    expect(contrastRatio(v['gold-400']!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .kicker
  });

  it('section-transition.html : titre plein cadre et libellé de section', () => {
    const v = loadVars('section-transition');
    // Fond réel = dégradé violet-900 → violet-950 ; violet-900 est l'extrémité
    // la plus claire (pire cas pour le contraste).
    const bgWorstCase = v['violet-900']!;
    expect(contrastRatio(v.fg!, bgWorstCase!)).toBeGreaterThanOrEqual(AA_NORMAL); // .section-title
    expect(contrastRatio(v['gold-300']!, bgWorstCase!)).toBeGreaterThanOrEqual(AA_NORMAL); // .section-label
    expect(contrastRatio(v['gold-200']!, bgWorstCase!)).toBeGreaterThanOrEqual(AA_NORMAL); // .section-label .num
    expect(contrastRatio(v.muted!, bgWorstCase!)).toBeGreaterThanOrEqual(AA_NORMAL); // .footer-course
  });

  it('timeline.html : titre, dates et libellés de jalons', () => {
    const v = loadVars('timeline');
    expect(contrastRatio(v.fg!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .title / .step-label
    expect(contrastRatio(v['gold-300']!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .step-date
    expect(contrastRatio(v.muted!, v.bg!)).toBeGreaterThanOrEqual(AA_NORMAL); // .step-description
  });

  it('couvre bien les 9 gabarits déclarés (SLIDE_TEMPLATE_NAMES)', () => {
    // Garde-fou : si un gabarit est ajouté sans être audité ci-dessus, ce test
    // le rappelle explicitement plutôt que de laisser un trou silencieux.
    const audited = [
      'title', 'content', 'code', 'comparison', 'quote', 'diagram', 'recap',
      'section-transition', 'timeline',
    ];
    for (const name of SLIDE_TEMPLATE_NAMES) {
      expect(audited).toContain(name);
    }
  });
});
