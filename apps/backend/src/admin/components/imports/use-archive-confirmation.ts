import { usePrompt } from "@medusajs/ui"

/**
 * A reusable confirmation step for archiving a card image, matching how
 * confirmation is done elsewhere in this codebase (`usePrompt()` called
 * inline) rather than introducing a new dialog-wrapper component.
 */
export function useArchiveConfirmation() {
  const prompt = usePrompt()

  return async (): Promise<boolean> => {
    return prompt({
      title: "Archive this image?",
      description: "The image is kept and can be restored later. It will no longer show in the active gallery.",
      confirmText: "Archive",
      cancelText: "Cancel",
      variant: "danger",
    })
  }
}
