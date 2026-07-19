# ADR 0013: `createCardFromInventoryRowWorkflow` compensation never deletes a discoverable catalogue row

## Status

Accepted for Stage 5B.3 (Codex remediation, second pass).

## Context

ADR 0012 defined `createCardFromInventoryRowWorkflow`'s job: resolve or create
the CardSet → TradingCard → TradingCardVariant → Product → ProductVariant →
InventoryItem chain for one proposal, converging concurrent requests for the
same card onto exactly one chain. The workflow's first version gave each of
the three creation steps (CardSet, TradingCard/Product, TradingCardVariant/
ProductVariant/InventoryItem) a compensation callback: if a later step (most
often the final claim-guarded proposal resolution) failed, the orchestrator
would run these callbacks in reverse order to delete whatever the failed
request itself had created — guarded by a "would this delete orphan
anything?" check (same-module `delete ... where not exists (...)` for
CardSet/TradingCard; a cross-module `listInventoryProposals` lookup for
TradingCardVariant) plus a short, bounded delay meant to give a genuinely
concurrent, slower-succeeding request more time to reach the point where the
guard would see it.

A Codex re-review of that version correctly rejected it: the delay only ever
changed the odds of the race, never closed it. A request whose own failure
happens to land after the delay (or that starts only after the failing
request's compensation has already run) can still be raced, and the
cross-module TradingCardVariant guard is a plain check-then-delete with no
atomic backstop at all — Medusa's workflow engine commits each step's own
transaction independently, so no single statement spanning both the
trading-cards and trading-card-inventory modules is available the way it is
for the same-module CardSet/TradingCard guards.

## Decision

Steps 1–3 of `createCardFromInventoryRowWorkflow` (`resolve-or-create-card-set`,
`resolve-or-create-card`, `resolve-or-create-variant`) register **no
compensation callback**. A CardSet, TradingCard, TradingCardVariant, Product,
ProductVariant, or InventoryItem any of these steps creates is left in place
if a later step (including the final proposal-resolution step) fails. The
300ms `COMPENSATION_REUSE_GRACE_MS` delay is removed along with the deletion
logic it existed to narrow the window for — there is no longer a
check-then-delete for it to protect.

This is safe because every one of these steps already performs an identity
lookup before creating anything (`listCardSets`, `listTradingCards`,
`listTradingCardVariants`, matching the same commercial identity the create
path uses). A failed request's leftover chain is discoverable — and reused,
not duplicated — by a retry of the same request or by an unrelated
concurrent request for the same card, through that same lookup. The
trade-off is explicit: a request that fails and is *never* retried can leave
behind an unreferenced CardSet/TradingCard/TradingCardVariant (and its
linked Product/ProductVariant/InventoryItem) with no proposal ever pointing
to it. That is accepted in exchange for the correctness guarantee this ADR
exists to record: compensation can never delete a row a concurrent request
has since started depending on, because compensation never deletes a
creation-path row at all.

`TradingCardsModuleService.deleteCardSetIfUnreferenced` /
`deleteTradingCardIfUnreferenced` (added for the first remediation pass) are
kept — they are correct, atomic, unit-tested primitives — but are no longer
called from this workflow's compensation path.

## Deferred: orphan sweep

Rows genuinely orphaned by a failed, never-retried request are not cleaned
up by this change. A safe sweep needs a durable ownership/lease/reference
mechanism — for example, a periodic reconciliation job that only removes a
CardSet/TradingCard/TradingCardVariant once it has had zero referencing rows
for a retention window long enough that no in-flight request could still be
about to claim it, rather than a synchronous check made at the moment one
request happens to fail. This is out of scope for Stage 5B.3 and is not
implemented here.

## Consequences

- A failed `createCardFromInventoryRowWorkflow` run is always safely
  retryable: retrying the same proposal reuses whatever chain the failed
  attempt left behind, via the same identity lookups, without duplicating
  any row.
- No compensation callback in this workflow can ever delete a
  CardSet/TradingCard/TradingCardVariant/Product/ProductVariant/
  InventoryItem a concurrent request has discovered and is depending on,
  regardless of timing.
- An unreferenced row left by a failed, never-retried request is a known,
  accepted possibility until the deferred sweep above is built.
