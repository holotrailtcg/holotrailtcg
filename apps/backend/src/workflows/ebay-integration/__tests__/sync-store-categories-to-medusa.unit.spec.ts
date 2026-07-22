import { EBAY_INTEGRATION_MODULE } from "../../../modules/ebay-integration"
import { syncStoreCategoriesToMedusa } from "../sync-store-categories-to-medusa"

function fakeCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ebaysc_1",
    environment: "SANDBOX",
    ebayAccountId: "acct_1",
    externalId: "1",
    name: "Mega Evolution Series",
    parentExternalId: null,
    siblingOrder: 0,
    level: 1,
    path: "Mega Evolution Series",
    status: "ACTIVE",
    source: "CSV",
    updatedAt: new Date(),
    medusaCategoryId: null,
    medusaCategorySyncedAt: null,
    ...overrides,
  }
}

type FakeProductCategory = {
  id: string
  name: string
  handle: string
  parent_category_id: string | null
  rank: number
}

function fakeContainer(
  categories: ReturnType<typeof fakeCategory>[],
  seedProductCategories: FakeProductCategory[] = [],
) {
  const store = new Map<string, FakeProductCategory>(seedProductCategories.map((c) => [c.id, { ...c }]))
  let nextId = 1
  const ebayIntegration = {
    listActiveStoreCategoriesForMedusaSync: jest.fn(async () => ({ categories })),
    linkStoreCategoryToMedusaCategory: jest.fn(async () => undefined),
    markStoreCategorySynced: jest.fn(async () => undefined),
    recordMedusaSyncAudit: jest.fn(async () => undefined),
  }
  const productModuleService = {
    listProductCategories: jest.fn(async (filter?: { id?: string[] }) => {
      if (filter?.id) return filter.id.map((id) => store.get(id)).filter((c): c is FakeProductCategory => Boolean(c))
      return [...store.values()]
    }),
    createProductCategories: jest.fn(
      async (input: { name: string; handle: string; parent_category_id: string | null; rank: number }) => {
        if ([...store.values()].some((c) => c.handle === input.handle)) {
          throw new Error(`Product category with handle: ${input.handle}, already exists.`)
        }
        const id = `pcat_${nextId++}`
        store.set(id, { id, name: input.name, handle: input.handle, parent_category_id: input.parent_category_id, rank: input.rank })
        return { id }
      },
    ),
    updateProductCategories: jest.fn(async (id: string, update: Partial<FakeProductCategory>) => {
      const existing = store.get(id)
      if (!existing) throw new Error(`Unknown product category: ${id}`)
      store.set(id, { ...existing, ...update })
    }),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === EBAY_INTEGRATION_MODULE) return ebayIntegration
      if (key === "product") return productModuleService
      throw new Error(`Unexpected resolve key: ${key}`)
    }),
  }
  return { container: container as never, ebayIntegration, productModuleService, store }
}

describe("syncStoreCategoriesToMedusa", () => {
  it("gives same-named sibling categories under different parents distinct, name-based handles", async () => {
    const categories = [
      fakeCategory({ id: "ebaysc_en", externalId: "10", name: "English", level: 1, path: "English" }),
      fakeCategory({ id: "ebaysc_jp", externalId: "20", name: "Japanese", level: 1, path: "Japanese" }),
      fakeCategory({
        id: "ebaysc_en_mega",
        externalId: "11",
        name: "Mega Evolution Series",
        parentExternalId: "10",
        level: 2,
        path: "English / Mega Evolution Series",
      }),
      fakeCategory({
        id: "ebaysc_jp_mega",
        externalId: "21",
        name: "Mega Evolution Series",
        parentExternalId: "20",
        level: 2,
        path: "Japanese / Mega Evolution Series",
      }),
    ]
    const { container, productModuleService } = fakeContainer(categories)

    const result = await syncStoreCategoriesToMedusa(container, {
      environment: "SANDBOX",
      actorId: "user_1",
      correlationId: "corr_1",
    })

    expect(result.failed).toBe(0)
    expect(result.created).toBe(4)
    const handles = productModuleService.createProductCategories.mock.calls.map((call) => call[0].handle)
    expect(new Set(handles).size).toBe(handles.length)
    // Non-colliding categories get a plain name slug, not an id-derived one.
    expect(handles).toContain("english")
    expect(handles).toContain("japanese")
    // The first "Mega Evolution Series" processed keeps the plain name slug;
    // the colliding sibling is disambiguated by parent, still human-readable.
    expect(handles).toContain("mega-evolution-series")
    expect(handles).toContain("japanese-mega-evolution-series")
  })

  it("repairs a previously id-based handle back to a name-based one on the next sync", async () => {
    const categories = [
      fakeCategory({ id: "ebaysc_root", externalId: "10", name: "Mega Evolution Series", level: 1, path: "Mega Evolution Series", medusaCategoryId: "pcat_legacy" }),
    ]
    const { container, store } = fakeContainer(categories, [
      { id: "pcat_legacy", name: "Mega Evolution Series", handle: "ebay-store-category-10", parent_category_id: null, rank: 0 },
    ])

    const result = await syncStoreCategoriesToMedusa(container, {
      environment: "SANDBOX",
      actorId: "user_1",
      correlationId: "corr_1",
    })

    expect(result.failed).toBe(0)
    expect(result.updated).toBe(1)
    expect(store.get("pcat_legacy")?.handle).toBe("mega-evolution-series")
  })

  it("repairs any drifted handle, not just the legacy id-based pattern, and stays idempotent afterwards", async () => {
    const categories = [
      fakeCategory({ id: "ebaysc_root", externalId: "10", name: "Black Star Promo Cards", level: 1, path: "Black Star Promo Cards", medusaCategoryId: "pcat_drifted" }),
    ]
    const { container, store } = fakeContainer(categories, [
      // A handle that drifted to a spurious "-2" suffix despite there being no real collision.
      { id: "pcat_drifted", name: "Black Star Promo Cards", handle: "black-star-promo-cards-2", parent_category_id: null, rank: 0 },
    ])

    const first = await syncStoreCategoriesToMedusa(container, {
      environment: "SANDBOX",
      actorId: "user_1",
      correlationId: "corr_1",
    })
    expect(first.failed).toBe(0)
    expect(first.updated).toBe(1)
    expect(store.get("pcat_drifted")?.handle).toBe("black-star-promo-cards")

    const second = await syncStoreCategoriesToMedusa(container, {
      environment: "SANDBOX",
      actorId: "user_1",
      correlationId: "corr_2",
    })
    expect(second.failed).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.unchanged).toBe(1)
    expect(store.get("pcat_drifted")?.handle).toBe("black-star-promo-cards")
  })
})
