# Pull Request

## Description

<!-- Résumé du changement : quoi, pourquoi, et capture d'écran avant/après si l'UI est touchée. -->

## Type de changement

- [ ] Fonctionnalité
- [ ] Correctif
- [ ] Refactoring / dette technique
- [ ] Design system (tokens, composants ui, motion)
- [ ] Infra / CI

---

## Checklist design SALISTAR

> Obligatoire dès qu'un fichier sous `apps/web/src` est modifié. Référence : `/design`, `/design/components`, `/design/motion`.

### Thème & tokens

- [ ] **Tokens uniquement** — aucune couleur hex inline ni classe arbitraire `bg-[#...]` / `text-[#...]` ; tout passe par les tokens (`bg-primary`, `text-accent-400`, `border-border`, `bg-surface`, ...) définis dans `packages/design/src/tokens.ts`
- [ ] **Dark mode** — l'écran est conçu et vérifié en dark (thème par défaut) ET reste correct en light (`:root` sans `.dark`)
- [ ] **Contraste AA** — textes et éléments interactifs respectent WCAG AA (≥ 4.5:1 texte courant, ≥ 3:1 grands titres et composants UI), vérifié dans les deux thèmes

### Internationalisation

- [ ] **RTL** — l'écran est vérifié en `dir="rtl"` (arabe) : propriétés logiques (`start`/`end`, `ps-`/`pe-`, `ms-`/`me-`), icônes directionnelles inversées, aucune casse de layout
- [ ] **Typo AR** — en arabe : `font-arabic`, jamais de serif, titres weight ≥ 600, jamais d'italique

### Responsive & accessibilité

- [ ] **Mobile** — vérifié à 390px de large (pas de débordement horizontal, cibles tactiles ≥ 44px)
- [ ] **Reduced motion** — `prefers-reduced-motion: reduce` respecté : les animations décoratives se coupent, le contenu reste accessible
- [ ] **Clavier & ARIA** — focus visible (halo or), navigation clavier complète, rôles/labels ARIA corrects

### Cohérence du design system

- [ ] **Composants réutilisés** — j'ai utilisé les composants de `apps/web/src/components/ui` (Button, Card, Dialog, Toast, ...) au lieu d'en recréer
- [ ] **Styleguide à jour** — si un composant/token a changé, `/design` ou `/design/components` reflète le nouvel état
- [ ] **Snapshots visuels** — `npx playwright test` passe ; les références mises à jour (`--update-snapshots`) sont incluses et justifiées dans la description

---

## Tests

- [ ] `pnpm typecheck` passe
- [ ] `pnpm lint` passe (inclut la règle anti-couleurs arbitraires)
- [ ] Tests unitaires ajoutés/mis à jour si pertinent
