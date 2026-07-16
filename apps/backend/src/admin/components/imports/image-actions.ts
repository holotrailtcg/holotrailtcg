import type { CardImageDto } from "./image-types"

/** Primary is not a stored flag — it is the READY image at sort order 0. */
export function isPrimary(image: CardImageDto): boolean {
  return image.status === "READY" && image.sortOrder === 0
}

export interface ImageActionVisibility {
  moveEarlier: boolean
  moveLater: boolean
  makePrimary: boolean
  archive: boolean
  restore: boolean
  changeFocalPoint: boolean
}

const NO_ACTIONS: ImageActionVisibility = {
  moveEarlier: false, moveLater: false, makePrimary: false, archive: false, restore: false, changeFocalPoint: false,
}

/**
 * Which image actions the detail page may offer for a given image, kept as
 * a pure function so it is testable without rendering. `position` and
 * `readyCount` describe the image's place among the variant's current READY
 * images (0-indexed), used to gate the ordering buttons at the ends.
 */
export function visibleImageActions(
  image: CardImageDto,
  position: number,
  readyCount: number
): ImageActionVisibility {
  if (image.status === "READY") {
    return {
      moveEarlier: position > 0,
      moveLater: position < readyCount - 1,
      makePrimary: position > 0,
      archive: true,
      restore: false,
      changeFocalPoint: true,
    }
  }
  if (image.status === "ARCHIVED") {
    return { ...NO_ACTIONS, restore: true }
  }
  return NO_ACTIONS
}

export type ReorderAction = "earlier" | "later" | "primary"

/** Pure array helper: builds the exact `orderedImageIds` array for a "move earlier/later/make primary" click. */
export function reorderedIds(currentIds: string[], imageId: string, action: ReorderAction): string[] {
  const index = currentIds.indexOf(imageId)
  if (index === -1) return currentIds

  const next = [...currentIds]
  if (action === "primary") {
    next.splice(index, 1)
    next.unshift(imageId)
    return next
  }

  const swapWith = action === "earlier" ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= next.length) return currentIds
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
  return next
}
