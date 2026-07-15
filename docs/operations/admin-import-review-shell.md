# Medusa Admin import and TCGdex review shell

Stage 4A.4.2 adds a Medusa Admin UI for the read-only Stage 4A.4.1 TCGdex
review API (see
[tcgdex-admin-review-api.md](tcgdex-admin-review-api.md)). It gives staff a
four-step import shell so the whole import journey is visible, even though
two of the four steps are not connected yet.

Stage 4A.4.3 connects the single-card review page's Approve, Reject, Apply
and Retry actions to the write routes added in that same stage. See
[Review actions](#review-actions) below; the rest of this document is
unchanged from Stage 4A.4.2.

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

## Review actions

The single-card review page (`/app/imports/review/:proposalId`) now offers
Approve, Reject, Apply and Retry, gated by the proposal's current lifecycle
status so the UI can never offer an action the backend would reject:

| Status | Buttons shown |
| --- | --- |
| `PENDING` | Approve, Reject, Retry |
| `APPROVED` | Apply, Retry |
| `REJECTED` | Retry |
| `APPLIED` | Retry |
| `SUPERSEDED` | none |

This mapping lives in `visibleReviewActions`
(`src/admin/components/imports/review-actions.ts`), a pure function tested
independently of rendering (`__tests__/review-actions.unit.spec.ts`) so the
button rules stay correct even as the page around them changes.

Reject and Apply ask for confirmation first, using Medusa UI's `usePrompt`
("Reject this match?" / "Apply these card details?"). Reject also shows an
optional, 300-character-bounded reason box, sent as `{ reason }` only when
non-empty. Approve and Retry act immediately — Approve because rejecting is
the safer default to protect, Retry because it never changes anything by
itself (it only records what TCGdex currently says).

Every action uses `@tanstack/react-query`'s `useMutation`. On success it
shows a Medusa UI toast and invalidates the `tcgdex-review`,
`tcgdex-reviews` and `tcgdex-attempts` query keys so the detail page, the
review list and the attempts list all refresh. On failure it shows a short,
static toast message (for example, "This match could not be rejected.
Please try again.") — never the raw response body — and leaves the page
exactly as it was.

Retry's success toast reflects the outcome TCGdex actually returned (for
example, "TCGdex could not find this card." for `NO_MATCH`), read from the
retry route's `{ outcome, review | attempt }` response.

## What is honestly not connected

- Step 1 (upload) and step 3 (assign images) are not built. The Admin pages
  say so; they do not collect input that goes nowhere.
- The "Ignore" button next to Approve/Reject/Apply/Retry is shown disabled
  with a "Not connected" tooltip. There is no ignore route or service
  method yet; the button makes no network call.
- The "Not matched" (attempts) tab is still read-only — there is no
  per-attempt detail view or resolve action, so a trading card that has
  only ever produced attempts (never a matched proposal) has no Retry
  button anywhere in this UI yet. Retry is reachable only from a review
  detail page, which requires an existing proposal.

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
