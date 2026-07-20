# Holo Trail TCG - Claude Instructions

## Project purpose

Build a secure, maintainable ecommerce platform for Holo Trail TCG.

The project will use:

- Medusa for products, variants, stock, pricing, promotions, baskets, checkout, orders and refunds.
- Next.js for the customer storefront.
- PostgreSQL for persistent data.
- Redis for Medusa workflows, caching and background jobs where required.
- Stripe for customer payments.
- Cloudflare R2 for product images.
- TCGdex for card identity and card metadata.
- Pulse for CSV inventory imports and current market prices.
- Resend for transactional email.
- Vercel for the storefront.
- Medusa Cloud, or another approved Node hosting service, for the Medusa backend and Admin.

The old repository is reference material only. Do not copy its checkout, payment, refund, authentication, order, inventory or Prisma architecture into this repository.

## Working approach

Claude is the main implementation agent.

For each task:

1. Read this file and the relevant project documentation.
2. Inspect the current repository before proposing changes.
3. Identify any ambiguity that could change the data model, security, payments, stock, pricing or external integrations.
4. Ask focused questions before coding when a material decision has not already been made.
5. Produce a short implementation plan.
6. Make the smallest complete change that satisfies the task.
7. Run the relevant targeted tests.
8. Review the actual diff.
9. Report what changed, which tests ran and any remaining risks.

Do not claim that work is complete when tests have not passed.

## Permissions and autonomy

Claude may:

- Read repository files.
- Search the repository.
- Create and edit files required by the approved task.
- Install approved project dependencies.
- Run formatting, linting, type checking and targeted tests.
- Run local development commands.
- Create database migrations after the schema change has been explicitly approved.
- Update documentation relating directly to the approved task.

Claude must ask before:

- Changing the agreed architecture.
- Adding a new hosted service or paid dependency.
- Replacing an existing major dependency.
- Changing production infrastructure.
- Changing environment variable names already in use.
- Changing payment, refund, stock, pricing, authentication or authorisation behaviour outside the approved task.
- Running destructive database commands.
- Resetting, dropping or reseeding a database.
- Deleting migrations or rewriting migration history.
- Publishing to eBay.
- Using live Stripe, eBay or production credentials.
- Deploying to production.
- Merging a pull request.
- Pushing directly to the protected default branch.
- Deleting or renaming a large number of files.

Never use permission-bypass modes for routine development.

## Safety rules

Never:

- Commit secrets, API keys, passwords, tokens or private credentials.
- Put secrets in variables beginning with `NEXT_PUBLIC_`.
- Log customer payment details, secrets or unnecessary personal data.
- expose server-only values to browser code.
- Trust CSV, webhook, API or form input without validation.
- Disable security checks merely to make a test pass.
- weaken authentication or authorisation to simplify implementation.
- invent external API fields or behaviour.
- silently ignore failed imports, payments, webhooks or stock updates.
- use production data for automated tests.
- run destructive commands against any database unless the user explicitly approves the exact command and target.

Use development, test and production resources separately.

Automated tests must refuse to run destructive database operations unless the database name clearly identifies it as a test database.

## Architecture boundaries

### Medusa owns

- Products
- Product variants
- Prices
- Promotions and coupons
- Stock and inventory levels
- Baskets
- Checkout
- Customers
- Orders
- Shipping
- Payment orchestration
- Captures
- Refunds

Do not recreate these systems in parallel custom tables unless Medusa requires an extension record.

### Holo Trail custom modules own

- Trading-card identity
- Card language, condition, finish and special treatment
- TCGdex matching and enrichment
- Pulse CSV imports
- Pulse market-price observations
- Holo Trail pricing rules
- Listing photographs
- eBay exports and later eBay synchronisation
- Import, pricing and integration audit records
- Future sell-to-us functionality

### Source-of-truth rules

- TCGdex defines canonical card metadata.
- Pulse supplies current market-price information and CSV inventory input.
- Medusa is the source of truth for sellable stock.
- Holo Trail controls the public selling price.
- A Pulse market price must not directly overwrite a locked or unapproved public price.
- A real Holo Trail photograph is always the primary product image.
- TCGdex artwork is a secondary reference image.

## Card model rules

A Medusa product represents one exact card identity.

Example:

`Gengar - Lost Origin - 066/196`

A Medusa variant represents one sellable version.

Example:

`English - Near Mint - Reverse Holo`

Identical cards may share one variant and use grouped quantity when all commercial attributes match.

Keep these concepts separate:

- Card identity
- Language
- Condition
- Finish
- Special treatment
- Rarity
- Inventory quantity
- Market price
- Suggested selling price
- Actual selling price
- Manual price lock

Supported site language is English.

Initial card languages are:

- English
- Japanese
- Chinese

The model must allow additional languages later.

Conditions must be configurable and initially support:

- Mint
- Near Mint
- Lightly Played
- Moderately Played
- Heavily Played
- Damaged

Do not confuse rarity with finish or special treatment.

## Pulse import rules

Pulse inventory arrives by CSV upload.

Every import must:

1. Validate the file type and structure.
2. Parse into a typed staging format.
3. Normalise values.
4. Match or propose card identities.
5. Show a preview before changing data.
6. Show new, changed, unchanged, unmatched and invalid rows.
7. Require approval before applying changes.
8. Record the approving user and timestamp.
9. Be idempotent where possible.
10. Preserve a complete import audit record.
11. Support a safe reversal or compensating workflow.
12. Fail clearly rather than partially succeeding without visibility.

Do not let a CSV upload immediately mutate live stock.

## TCGdex rules

Match cards primarily using stable identifiers such as:

- Set code
- Card number
- Language

Do not rely mainly on card name.

Matching outcomes must be explicit:

- MATCHED
- AMBIGUOUS
- NO_MATCH
- MANUALLY_MATCHED
- IGNORED

Ambiguous and missing matches must enter a review queue.

Manual matches must be retained for future imports.

Validate TCGdex responses before storing them.

## Market-price rules

Pulse market prices refresh daily.

Store market-price observations separately from public selling prices.

Initial pricing policy:

- Lower-value and ordinary cards use the approved Cardmarket-based Pulse value.
- Cards valued at £5 or more use the approved UK market value.
- Missing or unreliable prices enter manual review.
- Price history is retained.
- Public price changes require approval unless a later task explicitly enables safe auto-approval.
- Locked prices must never be changed automatically.
- Pricing rules must be configurable.

Use suitable low-value price points below £5.

For cards at £5 or above, whole-pound or approved commercial rounding may be used.

Never round a price below the configured minimum selling price.

## Image rules

Every sellable card must have a real Holo Trail photograph.

- The real photograph is the primary image.
- TCGdex artwork is the second image.
- Images are stored in Cloudflare R2.
- Public product images and future private sell-to-us images use separate buckets.
- Validate file extension, MIME type, size and file signature.
- Support image ordering, cropping and removal.
- Keep useful card photographs available for later listings unless deliberately archived.
- Higher-value cards may have multiple real photographs.

## eBay rules

The original eBay plan was export-only. Approved staged API work may now add
connection and later publishing capabilities, but every stage must remain
explicitly scoped, environment-isolated, and disabled by default.

It must support:

- Listing CSV export
- Price and quantity update export
- Listing title
- Description
- Condition
- Price
- Quantity
- Images
- eBay category
- eBay Store category
- Business-policy references
- Export history
- Variant-to-eBay mapping

Stage E1 authorises and stores an eBay User OAuth connection only. It must not
create categories, policies, inventory items, offers, listings, revisions, or
stock synchronisation. Do not publish to eBay unless a later approved task
explicitly enables that operation, first in Sandbox and separately in Production.
API publication and synchronisation are approved only as future staged work;
CSV remains a planned operational fallback. Pulse approval never publishes or
updates an eBay listing automatically.

Medusa remains the stock source of truth.

Do not treat website stock and eBay stock as independent physical stock.

## Payments

Use Medusa's standard Stripe payment provider.

Initial payment methods:

- Debit and credit cards
- Apple Pay
- Google Pay
- Stripe Link

Use Stripe test mode during development.

Do not use live keys until launch approval.

Verify webhook signatures.

Webhook processing must be idempotent and must record failed processing for reconciliation.

Refunds must be restricted to authorised Admin users and require confirmation.

Stripe Connect for seller payouts is outside the initial store launch scope.

## Shipping

Initial market is the United Kingdom only.

Shipping must remain configurable in Medusa Admin.

Initial rules:

- £1.99 standard delivery below £20.
- Free standard delivery at £20 or above.
- Tracked delivery for orders meeting the approved value threshold.
- Higher-value shipping rules must be configurable.

Do not hard-code Royal Mail prices throughout the codebase.

The Admin workflow should eventually support label creation, tracking and dispatch email.

## Storefront and components

Use reusable components. Do not duplicate equivalent UI or business logic.

Preferred sources:

- Medusa UI for Medusa Admin extensions.
- shadcn/ui for approved storefront components.
- Radix primitives through shadcn where appropriate.
- TanStack Table for complex import and review tables.

Third-party component code must be inspected before installation.

Keep components organised by purpose:

- `components/ui`
- `components/commerce`
- `components/cards`
- `components/layout`

Use one shared component for each common pattern, such as:

- Product card
- Price display
- Card image gallery
- Condition badge
- Finish badge
- Stock status
- Basket drawer
- Form field
- Dialog
- Table

Use component props or variants rather than copying components for minor visual differences.

## Brand rules

Retain the approved Holo Trail brand system from the legacy repository:

- Barlow Condensed for display typography.
- Source Sans 3 for body typography.
- Warm cream and off-white backgrounds.
- Navy, blue and purple accents.
- Square edges rather than rounded styling.

Copy approved design tokens and CSS values only after reviewing them.

Do not copy obsolete page-level CSS or legacy commerce behaviour.

## Design system (Stage 2A onward)

The Holo Trail storefront design system is established in the storefront app.
See [docs/design-system.md](docs/design-system.md) for the full reference. All
future storefront work must follow these rules:

- Holo Trail TCG Brand Guidelines v3 are the visual source of truth.
- Use the global Holo Trail CSS variables (`--ht-*` in
  `apps/storefront/src/styles/globals.css`); Tailwind is mapped to them.
- Barlow Condensed is the display/heading font; Source Sans 3 is the
  body/interface font. Both load globally via `next/font` (`lib/fonts.ts`).
- All corners are square (`border-radius: 0`); the Tailwind theme owns this.
- Blue is the primary action colour. Purple is restrained secondary emphasis.
  Cyan is mainly for the signal trail and small highlights, never a button
  background.
- Reuse components from `components/ui`, `components/layout`, `components/brand`
  and `components/feedback`. Do not duplicate standard controls inside feature
  folders.
- Do not introduce a second design system or a second (shadcn HSL) colour
  system alongside the Medusa ui-preset and the `--ht-*` tokens.
- Do not hard-code brand colours where a token exists.
- Do not install unreviewed component registries. Add shadcn components only via
  the reviewed flow documented in the design-system doc.
- Maintain accessible focus states (the focus token) and colour contrast; never
  communicate status by colour alone.
- New storefront pages must use the existing global tokens, layout primitives
  and shared UI components — no parallel styling systems or page-specific copies
  of standard controls.

## Code standards

- Use TypeScript strict mode.
- Use pnpm.
- Follow the repository's current formatting and lint rules.
- Prefer clear names over abbreviations.
- Keep functions focused.
- Validate external input at boundaries.
- Use shared schemas and types rather than duplicate definitions.
- Avoid `any`. Explain and isolate unavoidable cases.
- Do not suppress TypeScript or lint errors without a documented reason.
- Do not add speculative abstractions.
- Do not modify generated files manually.
- Do not edit dependency lockfiles by hand.
- Prefer framework extension points over patching Medusa core.
- Preserve accessibility in all customer-facing components.
- Use standard hyphens in user-facing copy.

## Testing standards

Every material change needs appropriate tests.

Use unit tests for:

- Parsers
- Normalisation
- SKU generation
- Price rules
- Category mappings
- eBay title generation
- Environment validation

Use integration tests for:

- Custom modules
- Workflows
- API routes
- Product and variant creation
- Stock changes
- Import approval
- Workflow rollback
- Webhook processing
- Authorisation

Use Playwright for critical customer journeys:

- Browse products
- Search
- Add to basket
- Change quantity
- Guest checkout
- Payment
- Order confirmation
- Customer order history
- Admin refund
- Final-unit stock behaviour

Test important failure cases, including:

- Invalid CSV
- Duplicate import
- Ambiguous card match
- Missing Pulse price
- Invalid webhook signature
- Duplicate webhook
- Failed payment
- Concurrent purchase of the final unit
- eBay stock-update failure
- Unauthorised Admin action
- Invalid or oversized image upload

## Database and migration rules

- Use separate development, test and production databases.
- Never run automated tests against development or production.
- Inspect generated migrations before applying them.
- Never rewrite migration history once shared.
- Do not use ad-hoc production SQL as a substitute for a migration.
- Do not reset a database unless the exact target has been verified and explicitly approved.
- Production migrations are a controlled deployment step.
- Seed scripts must not run automatically in production.

## Environment variables

- Commit `.env.example`.
- Never commit real `.env` files.
- Validate required variables when each application starts.
- Keep browser-safe and server-only schemas separate.
- Only use `NEXT_PUBLIC_` for values that are safe to expose publicly.
- Document each variable, where it comes from and which environments require it.
- Use feature flags for unfinished external integrations.

Initial feature flags should include:

- Coming-soon mode
- Pulse import
- Pulse price refresh
- TCGdex enrichment
- Stripe payments
- eBay export
- eBay API publishing
- Automatic repricing

## Git workflow

- Work on a task-specific branch.
- Do not commit unrelated changes.
- Review `git status` and the complete diff before committing.
- Use clear commit messages.
- Do not push directly to the protected default branch.
- Do not merge without the required review and passing checks.
- Keep each commit logically coherent.
- Do not include generated caches, local databases, credentials or temporary files.

Before handing off work, provide:

- A concise summary.
- Changed files.
- Database migrations.
- Environment-variable changes.
- Tests run and results.
- Known limitations.
- Manual checks still required.

## Stage discipline

Work only on the approved stage.

Do not begin later features merely because they are related.

The broad order is:

1. Clean Medusa foundation.
2. Quality controls and CI.
3. Brand tokens and reusable components.
4. Coming-soon page and subscriptions.
5. Trading-card domain model.
6. TCGdex enrichment.
7. Real-card image library.
8. Pulse CSV inventory import.
9. Pulse market-price refresh and review.
10. Products, pricing and promotions.
11. Shipping.
12. Stripe test checkout.
13. Customer storefront.
14. Admin tools.
15. eBay export.
16. Legal, analytics and consent.
17. Production hardening and launch.

Each stage must be tested and reviewed before the next stage begins.

## Documentation

Keep documentation current when behaviour changes.

Important decisions should be recorded in `docs/decisions`.

Operational procedures should be recorded in `docs/operations`.

Do not use `CLAUDE.md` as a changelog or a store for temporary task notes.

## Definition of done

A task is complete only when:

- The approved requirement is implemented.
- The implementation follows the architecture boundaries.
- Relevant tests pass.
- Type checking and linting pass for the affected scope.
- The diff has been reviewed.
- Security and failure paths have been considered.
- Documentation and `.env.example` are updated when required.
- No secrets or production data are included.
- Remaining limitations are stated clearly.
