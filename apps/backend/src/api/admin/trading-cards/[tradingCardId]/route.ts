import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { adminActor, parseAdminInput, safeAdminRead, safeAdminWrite, tradingCardsService, updateTradingCardIdentityBodySchema } from "../shared"

const paramsSchema = z.object({ tradingCardId: z.string().trim().min(1) })

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { tradingCardId } = parseAdminInput(paramsSchema, req.params)
  const [card] = await safeAdminRead(() => tradingCardsService(req).listTradingCards({ id: tradingCardId }, { take: 1, relations: ["card_set"] }))
  if (!card) {
    res.status(404).json({ message: "Trading card not found" })
    return
  }
  res.status(200).json({ card })
}

/**
 * Stage 1: manual local correction for an already-existing card's canonical
 * identity fields, including illustrator. Reuses `updateTradingCardIdentity`
 * (pre-existing, previously with no Admin route) — never creates a
 * duplicate CardSet/TradingCard/TradingCardVariant, only edits the one row.
 * A confirmed illustrator (`illustratorConfirmed: true`) is protected from
 * being silently overwritten by a later unapproved provider value.
 */
export async function PATCH(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { tradingCardId } = parseAdminInput(paramsSchema, req.params)
  const body = parseAdminInput(updateTradingCardIdentityBodySchema, req.body ?? {})

  const saved = await safeAdminWrite(() => tradingCardsService(req).updateTradingCardIdentity({
    id: tradingCardId, actor: adminActor(req), source: "MANUAL", reason: body.reason ?? null,
    cardSetId: body.cardSetId, name: body.name, searchName: body.searchName, slug: body.slug,
    cardNumber: body.cardNumber, illustrator: body.illustrator, illustratorConfirmed: body.illustratorConfirmed,
    expectedUpdatedAt: body.expectedUpdatedAt ?? null,
  }))

  res.status(200).json({ card: saved })
}
