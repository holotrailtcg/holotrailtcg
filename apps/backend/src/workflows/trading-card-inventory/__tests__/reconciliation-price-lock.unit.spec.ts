import { reconcileInventorySnapshotWithPriceLocks } from "../reconcile-inventory-snapshot"

describe("reconciliation price-lock orchestration", () => {
  it("bulk-loads variants and passes only locked IDs to the provider-neutral engine", async () => {
    const reconcileInventorySnapshot = jest.fn(async (input) => input)
    const inventory = {
      listSnapshotVariantIds: jest.fn(async () => ["tcvar_locked", "tcvar_open"]),
      reconcileInventorySnapshot,
    }
    const cards = { listTradingCardVariants: jest.fn(async () => [
      { id: "tcvar_locked", price_locked: true }, { id: "tcvar_open", price_locked: false },
    ]) }
    const container = { resolve: jest.fn((key: string) => key === "tradingCardInventory" ? inventory : cards) }
    await reconcileInventorySnapshotWithPriceLocks(container as never, {
      inventorySourceId: "tcisrc_1", snapshotId: "tcisnap_2", previousApprovedSnapshotId: "tcisnap_1",
      actor: "tester", source: "SYSTEM",
    })
    expect(inventory.listSnapshotVariantIds).toHaveBeenCalledWith(["tcisnap_2", "tcisnap_1"])
    expect(cards.listTradingCardVariants).toHaveBeenCalledWith({ id: ["tcvar_locked", "tcvar_open"] })
    expect(reconcileInventorySnapshot).toHaveBeenCalledWith(expect.objectContaining({ priceLockedVariantIds: ["tcvar_locked"] }))
  })
})
