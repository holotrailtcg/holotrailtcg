import { isPrimary, reorderedIds, visibleImageActions } from "../image-actions"
import type { CardImageDto } from "../image-types"

function image(overrides: Partial<CardImageDto> = {}): CardImageDto {
  return {
    id: "tcimg_1", status: "READY", tradingCardVariantId: "tcvar_1", originalFilename: "card.jpg",
    confirmedMimeType: "image/jpeg", width: 6, height: 8, sortOrder: 0, focalX: 0.5, focalY: 0.5,
    imageUrl: "https://example.invalid/card.jpg", createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  }
}

describe("isPrimary", () => {
  it("is true only for a READY image at sort order 0", () => {
    expect(isPrimary(image({ status: "READY", sortOrder: 0 }))).toBe(true)
    expect(isPrimary(image({ status: "READY", sortOrder: 1 }))).toBe(false)
    expect(isPrimary(image({ status: "ARCHIVED", sortOrder: 0 }))).toBe(false)
  })
})

describe("visibleImageActions", () => {
  it("offers move-later, make-primary and archive for the first of several ready images", () => {
    expect(visibleImageActions(image({ status: "READY" }), 0, 3)).toEqual({
      moveEarlier: false, moveLater: true, makePrimary: false, archive: true, restore: false, changeFocalPoint: true,
    })
  })

  it("offers move-earlier, move-later and make-primary for a middle ready image", () => {
    expect(visibleImageActions(image({ status: "READY" }), 1, 3)).toEqual({
      moveEarlier: true, moveLater: true, makePrimary: true, archive: true, restore: false, changeFocalPoint: true,
    })
  })

  it("offers only move-earlier, make-primary and archive for the last ready image", () => {
    expect(visibleImageActions(image({ status: "READY" }), 2, 3)).toEqual({
      moveEarlier: true, moveLater: false, makePrimary: true, archive: true, restore: false, changeFocalPoint: true,
    })
  })

  it("offers only restore for an archived image", () => {
    expect(visibleImageActions(image({ status: "ARCHIVED" }), 0, 0)).toEqual({
      moveEarlier: false, moveLater: false, makePrimary: false, archive: false, restore: true, changeFocalPoint: false,
    })
  })

  it("offers no actions for a pending or terminal image", () => {
    expect(visibleImageActions(image({ status: "PENDING" }), 0, 0)).toEqual({
      moveEarlier: false, moveLater: false, makePrimary: false, archive: false, restore: false, changeFocalPoint: false,
    })
  })
})

describe("reorderedIds", () => {
  it("swaps with the previous image on 'earlier'", () => {
    expect(reorderedIds(["a", "b", "c"], "b", "earlier")).toEqual(["b", "a", "c"])
  })

  it("swaps with the next image on 'later'", () => {
    expect(reorderedIds(["a", "b", "c"], "b", "later")).toEqual(["a", "c", "b"])
  })

  it("moves the target to the front on 'primary'", () => {
    expect(reorderedIds(["a", "b", "c"], "c", "primary")).toEqual(["c", "a", "b"])
  })

  it("is a no-op when 'earlier' is requested at the start", () => {
    expect(reorderedIds(["a", "b", "c"], "a", "earlier")).toEqual(["a", "b", "c"])
  })

  it("is a no-op when 'later' is requested at the end", () => {
    expect(reorderedIds(["a", "b", "c"], "c", "later")).toEqual(["a", "b", "c"])
  })

  it("is a no-op for an id that is not in the current list", () => {
    expect(reorderedIds(["a", "b", "c"], "missing", "earlier")).toEqual(["a", "b", "c"])
  })
})
