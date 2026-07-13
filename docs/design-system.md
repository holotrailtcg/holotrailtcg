# Holo Trail TCG design system

This is the reference for the storefront design system established in Stage 2A.

> **Contributor rule:** New storefront pages and features must use the existing
> global tokens, layout primitives and shared UI components. Do not create
> parallel styling systems or page-specific copies of standard controls.

## Source of truth

- **Holo Trail TCG Brand Guidelines v3** are the visual source of truth.
- The **CSS custom properties** in
  [`apps/storefront/src/styles/globals.css`](../apps/storefront/src/styles/globals.css)
  (`:root { --ht-* }`) are the single source of truth in code. Tailwind is
  mapped to them in
  [`tailwind.config.js`](../apps/storefront/tailwind.config.js).
- There is **no dark theme** — one light brand surface for storefront and Admin.

We deliberately namespace the tokens with `--ht-` to avoid clashing with the
`@medusajs/ui-preset` variables (`--bg-*`, `--fg-*`, …) that the DTC Starter
already relies on.

## Colour tokens

| Token (`--ht-*`)          | Value     | Tailwind class base    | Purpose                              |
| ------------------------- | --------- | ---------------------- | ------------------------------------ |
| `background-page`         | `#F8F7F5` | `bg-page`              | Default page background              |
| `background-store`        | `#F7F1E8` | `bg-store`             | Shop/store background                |
| `surface`                 | `#FFFDF8` | `bg-surface`           | Cards, panels, inputs                |
| `surface-alt`             | `#F0E8DC` | `bg-surface-alt`       | Alternative/secondary surface        |
| `text-primary`            | `#162033` | `text-ink`             | Primary text                         |
| `text-muted`              | `#5D6575` | `text-ink-muted`       | Muted/secondary text                 |
| `text-on-dark`            | `#F8F7F5` | `text-ink-on-dark`     | Text on navy/contrast surfaces       |
| `border`                  | `#D8D0C4` | `border-line`          | Default borders                      |
| `border-strong`           | `#C4BACB` | `border-line-strong`   | Emphasised borders, control outlines |
| `action-primary`          | `#2563EB` | `bg-action`            | Primary action (blue)                |
| `action-primary-hover`    | `#1D4ED8` | `hover:bg-action-hover`| Primary hover                        |
| `action-primary-active`   | `#1E40AF` | `active:bg-action-active`| Primary active/pressed             |
| `action-primary-text`     | `#FFFFFF` | `text-action-text`     | Text on primary action               |
| `accent-secondary`        | `#6D5BD0` | `text-accent`/`bg-accent`| Restrained secondary emphasis      |
| `navigation`              | `#121C30` | `bg-navy`              | Navigation / navy surfaces           |
| `signal-cyan`             | `#67E8F9` | `bg-signal`/`text-signal`| Signal trail and small highlights  |
| `focus-ring`              | `#2563EB` | `ring-focus`           | Focus ring                           |

**Blue** is the main action colour. **Purple** is restrained secondary emphasis
(links, small accents) — it is not a standard button colour. **Cyan** belongs to
the signal trail, selection highlight and small highlights, and is never a
button background.

### Functional status colours

These are **functional UI colours, not new brand accents.** They exist only to
communicate state accessibly on the cream surfaces. Foreground values meet AA
contrast on `--ht-surface`; `*-surface` values are soft tints for alert
backgrounds.

| Token (`--ht-*`)  | Foreground | Surface tint | Tailwind base   |
| ----------------- | ---------- | ------------ | --------------- |
| `status-success`  | `#15803D`  | `#EAF5EC`    | `success` / `success-surface` |
| `status-warning`  | `#B45309`  | `#FBF0E2`    | `warning` / `warning-surface` |
| `status-error`    | `#B91C1C`  | `#FBEAEA`    | `danger` / `danger-surface`   |
| `status-info`     | `#1D4ED8`  | `#EAEFFB`    | `info` / `info-surface`       |

Status must never be conveyed by colour alone — always pair colour with a
title, icon or prefix word (see `Alert` and `StatusMessage`).

## Typography

Loaded globally once via `next/font` in
[`lib/fonts.ts`](../apps/storefront/src/lib/fonts.ts) and applied on `<html>` in
the root layout (no per-page loading, `display: swap`, system fallbacks → no
layout shift).

- **Barlow Condensed** → display/headings — `--font-display`, `font-display`.
- **Source Sans 3** → body/interface (global default) — `--font-body`,
  `font-sans`.

Canonical type utilities (in `globals.css`, use these rather than one-off sizes):

| Class               | Role            | Size (clamp)                | Font    |
| ------------------- | --------------- | --------------------------- | ------- |
| `.ht-display-hero`  | Display hero    | 44 → 84px                   | Display |
| `.ht-heading-page`  | Page heading    | 32 → 48px                   | Display |
| `.ht-heading-section`| Section heading| 40 → 56px                   | Display |
| `.ht-heading-card`  | Card title      | 24 → 32px                   | Display |
| `.ht-body-lg`       | Body large      | 17 → 18px, 1.55 lh          | Body    |
| `.ht-body`          | Body standard   | 16 → 18px, 1.6 lh           | Body    |
| `.ht-body-sm`       | Body small      | 14px                        | Body    |
| `.ht-label`         | Interface label | 14px, 600                   | Body    |
| `.ht-caption`       | Caption         | 12px, muted                 | Body    |
| `.ht-button-text`   | Button text     | 15px, 600                   | Body    |

## Shape

**All corners are square — `border-radius: 0` globally.** The Tailwind
`borderRadius` scale resolves every box radius (`rounded`, `rounded-md`,
`rounded-lg`, …) to `0`, so the theme owns the rule; do not override radius per
component. `rounded-full`/`rounded-circle` are retained **only** for genuine
circles (loading spinners, country-flag icons), which are not "corners".

## Content width and gutters

- `--ht-content-width` (1440px) → Tailwind `max-w-content`.
- `--ht-content-gutter` (1.5rem) → horizontal page padding.
- Use `<ContentContainer>` rather than hard-coding widths.

## Component folder ownership

Under `apps/storefront/src/`:

| Folder                | Owns                                             |
| --------------------- | ------------------------------------------------ |
| `components/ui`       | Generic design-system primitives                 |
| `components/layout`   | Global page and section layout                   |
| `components/brand`    | Reusable Holo Trail identity components           |
| `components/feedback` | Shared status and feedback components            |
| `components/privacy`  | Future consent and privacy components (reserved) |
| `components/coming-soon` | Reserved for Stage 2B                         |
| `content/`            | Replaceable page copy and configuration          |
| `lib/`                | Utilities and clients (`cn`, fonts, data)        |

> The starter's existing `modules/common/components/ui` barrel is
> **starter-internal** and still used by the checkout/cart/account flows. It has
> been retuned to the brand tokens (colours + square corners) but is not the
> place to add new primitives — new work uses `components/*`.

Do not create duplicate standard controls inside feature folders.

## Shared components

`components/ui`

- `Button` — variants `primary` | `secondary` | `outline` | `ghost` |
  `destructive`; sizes `sm` | `md` | `lg`; `isLoading`; hover/active/focus/
  disabled states.
- `Input` — text input with error state and accessible focus.
- `Label` — form label with optional required indicator.
- `Checkbox` — native square checkbox styled with tokens.
- `Alert` — boxed status message (`info` | `success` | `warning` | `error`).
- `FormField` — label + required + help text + validation error with correct
  `aria-describedby` / `aria-invalid` wiring (render-prop, control-agnostic).
- `ExternalLink` — outbound link with safe `rel` and new-tab announcement.

`components/layout`

- `PageShell` — page background + top-level document column
  (`surface="page" | "store"`).
- `ContentContainer` — global max width + responsive gutters (polymorphic `as`).
- `Section` — semantic `<section>` with standard vertical spacing.

`components/brand`

- `BrandLogo` — identity mark with a safe Barlow Condensed text fallback;
  `variant`, `context="light" | "navy"`, graceful image-error fallback.

`components/feedback`

- `StatusMessage` — compact inline status line for form/action feedback.

### Button variants

| Variant       | Treatment                                             |
| ------------- | ----------------------------------------------------- |
| `primary`     | Action blue (`bg-action`) — the main call to action    |
| `secondary`   | Restrained neutral fill (`bg-surface-alt`)             |
| `outline`     | Bordered, transparent fill                            |
| `ghost`       | Transparent, subtle hover                             |
| `destructive` | Functional error colour for irreversible actions      |

All buttons use sentence case, square corners, and the accessible focus ring.

### Form pattern

Use `FormField` to wrap a control. It provides `id`, `describedBy`, `invalid`
and `hasError` to a render-prop child so the label, help text and error message
are correctly associated. No form library is added; `FormField` is
control-agnostic.

```tsx
<FormField id="email" label="Email" required helpText="We never share it." error={error}>
  {({ id, describedBy, hasError }) => (
    <Input id={id} name="email" type="email" aria-describedby={describedBy} hasError={hasError} />
  )}
</FormField>
```

## Brand asset paths

`BrandLogo` renders a text wordmark until Scott adds the real approved SVGs
(see [`public/brand/README.md`](../apps/storefront/public/brand/README.md)):

- `public/brand/logo-primary.svg` — full logo, light/cream surfaces
- `public/brand/logo-on-navy.svg` — full logo, navy/contrast surfaces
- `public/brand/logo-icon.svg` — square icon / app mark
- `public/brand/wordmark.svg` — wordmark only

## Light and navy surfaces

- Light/cream surfaces use `bg-page` / `bg-store` / `bg-surface` with `text-ink`
  and `text-ink-muted`.
- Navy/contrast surfaces use `bg-navy` with `text-ink-on-dark`; put the signal
  cyan and `BrandLogo context="navy"` here.

## Icon rules

- The storefront's icon library is **`@medusajs/icons`** (already installed),
  with the local set in `modules/common/icons` for a few bespoke marks. Do not
  add a second icon library without a demonstrated reason.
- Icons inherit `currentColor`.
- Decorative icons are hidden from assistive technology (`aria-hidden`).
- Functional icon-only controls require an accessible name.
- Never use emoji as permanent interface icons.

## Accessibility requirements

- Visible keyboard focus everywhere via the focus token (global
  `:focus-visible` + component `ring-focus`).
- Skip-to-content link (`.skip-to-content`) targets `<main id="main-content">`.
- Semantic landmarks and headings.
- Reduced-motion honoured globally (`prefers-reduced-motion`).
- Accessible selection styling (signal cyan background, ink text).
- Consistent disabled styling (`disabled:opacity-50`).
- Clear error styling; **status is never colour-only** — pair with text/icon.

## Adding shadcn components safely

We do **not** run `shadcn init` (it would overwrite the Medusa-preset globals
and introduce a conflicting HSL colour system). Instead we use the shadcn
*pattern*: components live in the repo, use `cn` (`lib/utils.ts`), CVA variants
and the `--ht-*` tokens. See
[ADR 0003](decisions/0003-storefront-design-system.md).

To add a shadcn component later:

1. Inspect its source first (never install blindly).
2. Prefer `pnpm dlx shadcn@latest add <name>` — `components.json` targets
   `src/components/ui`, `@/lib/utils` and `baseColor: stone`.
3. **Re-theme it to the tokens**: remove default shadcn colour classes and use
   the `--ht-*`-backed Tailwind classes; keep `rounded-none`.
4. Confirm no duplicate of an existing primitive is introduced.

## How to theme a new component

- Compose classes with `cn(...)`.
- Use token-backed Tailwind classes (`bg-surface`, `text-ink`, `border-line`,
  `bg-action`, `ring-focus`, …) — never raw hex.
- Keep corners square (rely on the theme; do not add radius).
- Add accessible focus (`focus-visible:ring-2 focus-visible:ring-focus
  focus-visible:ring-offset-2 focus-visible:ring-offset-page`).
- Type the props, forward refs where a DOM node is exposed, and allow
  `className` extension.

## How to avoid hard-coded values

- No raw brand hex in components — use tokens/Tailwind classes.
- No hard-coded widths — use `ContentContainer` / `max-w-content`.
- No one-off font sizes — use the `.ht-*` type utilities.
- No per-component radius overrides — the theme is square globally.
- No page-specific copy inside generic components — pass copy in from `content/`.
