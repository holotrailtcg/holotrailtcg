import type { ReviewStatus } from "./types"

/** The reject reason box is bounded to match the backend's `MAX_REJECT_REASON_LENGTH`. */
export const MAX_REJECT_REASON_LENGTH = 300

export interface ReviewActionVisibility {
  approve: boolean
  reject: boolean
  apply: boolean
  retry: boolean
}

const NO_ACTIONS: ReviewActionVisibility = { approve: false, reject: false, apply: false, retry: false }

/**
 * Which review actions the single-card review page may offer for a given
 * lifecycle status. Kept as a pure function so it is testable without
 * rendering, and so the page component can never assemble an invalid
 * combination of buttons.
 */
export function visibleReviewActions(status: ReviewStatus): ReviewActionVisibility {
  switch (status) {
    case "PENDING":
      return { approve: true, reject: true, apply: false, retry: true }
    case "APPROVED":
      return { approve: false, reject: false, apply: true, retry: true }
    case "REJECTED":
      return { approve: false, reject: false, apply: false, retry: true }
    case "APPLIED":
      return { approve: false, reject: false, apply: false, retry: true }
    case "SUPERSEDED":
      return NO_ACTIONS
    default:
      return NO_ACTIONS
  }
}
