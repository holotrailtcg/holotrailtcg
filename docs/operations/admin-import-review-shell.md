# Medusa Admin import and TCGdex review shell

Stage 4A.4.2 adds a Medusa Admin UI for the read-only Stage 4A.4.1 TCGdex
review API (see
[tcgdex-admin-review-api.md](tcgdex-admin-review-api.md)). It gives staff a
four-step import shell so the whole import journey is visible, even though
two of the four steps are not connected yet.

## Pages

- `/app/imports` — overview of the four steps (Upload, Sync with TCGdex,
  Assign images, Check and approve) with a "Connected" or "Not connected"
  state for each.
- `/app/imports/new` — step 1 (upload). Not connected: there is no Pulse CSV
  import backend yet, so this page only explains that and links back.
- `/app/imports/review` — steps 2 and 4 combined. Two tabs:
  - **Sync with TCGdex**: matched proposals from `GET /admin/tcgdex/reviews`,
    with search and a status filter.
  - **Not matched**: attempts from `GET /admin/tcgdex/attempts`, with search
    and an outcome filter.
- `/app/imports/review/:proposalId` — single-card review view using `GET
  /admin/tcgdex/reviews/:proposalId`. Shows a side-by-side comparison of the
  local trading card against the TCGdex snapshot, the TCGdex reference
  artwork, and the lifecycle audit history.

Step 3 (assign card images) has no page yet — there is no image-assignment
backend to connect it to.

## What is honestly not connected

- Step 1 (upload) and step 3 (assign images) are not built. The Admin pages
  say so; they do not collect input that goes nowhere.
- The "Approve" and "Reject" buttons on the single-card review view are
  shown disabled with a "Not available yet" tooltip. No write endpoint
  exists yet (see the deferred work in
  [tcgdex-admin-review-api.md](tcgdex-admin-review-api.md)), so these
  buttons make no network call.
- The "Not matched" (attempts) tab is read-only. There is no per-attempt
  detail view, retry, or resolve action, matching the read-only attempts
  API.

## Styling

The Imports pages use `@medusajs/ui` components only. One small scoped
stylesheet, `apps/backend/src/admin/styles/imports.css`, is imported by each
Imports route and nests all of its rules under a `.ht-imports` wrapper class
so nothing leaks into the rest of Admin. It forces square corners on tables,
buttons and inputs within the Imports pages, and reuses two Holo Trail
accent hex values (the focus ring and primary action colour) that mirror
`apps/storefront/src/styles/globals.css`. This is a deliberately small first
step toward brand parity in Admin, not a full re-theme.

## Data flow

Both review tabs and the detail page use `@tanstack/react-query` with
`fetch(..., { credentials: "include" })` against the existing
`/admin/tcgdex/*` routes, following the pattern already established in
`apps/backend/src/admin/widgets/trading-card-widget.tsx`. No new backend
routes were added in this stage.
