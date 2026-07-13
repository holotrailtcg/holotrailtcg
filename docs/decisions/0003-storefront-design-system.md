# 0003 — Storefront design system and shadcn pattern (without `shadcn init`)

- **Status:** Accepted
- **Date:** 2026-07-13
- **Stage:** 2A (brand tokens and reusable components)

## Context

Stage 2A establishes the global Holo Trail visual system and a reusable
component foundation for the Next.js storefront, per Brand Guidelines v3.

The storefront is the Medusa **DTC Starter**, which already ships:

- Tailwind CSS **v3** with the `@medusajs/ui-preset` preset. The preset owns a
  large token system exposed as CSS variables (`--bg-*`, `--fg-*`, …) and
  Tailwind classes (`bg-ui-bg-field`, `text-ui-fg-base`, `txt-compact-medium`)
  used throughout checkout, cart and account.
- A **local** primitive barrel at `modules/common/components/ui/index.tsx`
  (Button, Input, Label, Checkbox, Badge, Table, …) that replaces
  `@medusajs/ui` (which is not a dependency) and is imported across the app.
- Aliases `@lib/*`, `@modules/*`, `@pages/*` (no `@/*`).

The brief asks for shadcn/ui "if it is not already correctly configured", but
also explicitly forbids creating a second (shadcn HSL) colour system and
overwriting the global CSS.

## Decision

### Tokens are the source of truth, namespaced `--ht-*`

All brand values are CSS custom properties in `styles/globals.css`
(`:root { --ht-* }`), mapped into Tailwind (`tailwind.config.js`) as
`var(--ht-*)`. We namespace with `--ht-` to avoid colliding with the
`@medusajs/ui-preset` variables. Components use token-backed Tailwind classes,
never raw hex.

### Square corners owned by the theme

The Tailwind `borderRadius` scale resolves every box radius to `0`.
`full`/`circle` are retained only for genuine circles (spinners, flags).

### Fonts via `next/font`

Barlow Condensed (display) and Source Sans 3 (body) load once via
`lib/fonts.ts` and are applied on `<html>` — no per-page loading, `swap`, system
fallbacks, so no layout shift.

### shadcn *pattern*, not `shadcn init`

We do **not** run `shadcn init`. Running it would rewrite `globals.css` and the
Tailwind config and introduce shadcn's HSL `--background`/`--foreground`/…
tokens — a second colour system alongside the Medusa preset and the `--ht-*`
tokens, which the brief forbids.

Instead we adopt the shadcn *pattern*: components live in the repo under
`components/*`, use a `cn` helper (`clsx` + `tailwind-merge` in `lib/utils.ts`),
CVA variants, and the `--ht-*` tokens. A `components.json` is added and
configured (aliases → `src/components`, `@/lib/utils`, `baseColor: stone`) so a
future `pnpm dlx shadcn add <name>` places files correctly — each such addition
must be inspected and re-themed to the tokens.

Packages added to the storefront: `class-variance-authority` and
`tailwind-merge` (both used by the pattern). No icon library is added — the
existing `@medusajs/icons` is the storefront icon set.

### New component homes; legacy barrel retuned, not replaced

New primitives live in `components/{ui,layout,brand,feedback}` (plus reserved
`components/{privacy,coming-soon}` and `content/`). The starter's existing
`modules/common/components/ui` barrel remains the internal set for checkout/cart/
account and was **retuned** to the brand tokens (primary button → action blue,
square badges) — a colour/shape change only, no logic change. It is not the
place to add new primitives.

## Consequences

- One brand colour system (`--ht-*`), no shadcn HSL duplicate, Medusa preset
  intact.
- Existing starter routes render on-brand via the theme (square corners, cream
  background, brand primary buttons) without rewriting their code.
- Adding shadcn components later is a documented, reviewed, re-themed step
  (see [design-system.md](../design-system.md)).
- Guest basket and checkout **architecture** were not changed; only presentation
  tokens were applied.
- Aliases `@/*`, `@components/*`, `@content/*` were added to `tsconfig.json`
  alongside the existing ones.
