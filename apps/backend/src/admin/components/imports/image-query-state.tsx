import { Text } from "@medusajs/ui"

interface ImageQueryStateProps {
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  loadingMessage?: string
  errorMessage?: string
  emptyMessage: string
}

/** Shared loading/error/empty state, used by both the images list and detail pages. */
const ImageQueryState = ({
  isLoading,
  isError,
  isEmpty,
  loadingMessage = "Loading…",
  errorMessage = "This could not be loaded. Please try again.",
  emptyMessage,
}: ImageQueryStateProps) => {
  if (isLoading) {
    return (
      <Text size="small" className="p-4 text-ui-fg-subtle">
        {loadingMessage}
      </Text>
    )
  }
  if (isError) {
    return (
      <Text size="small" className="p-4 text-ui-fg-error">
        {errorMessage}
      </Text>
    )
  }
  if (isEmpty) {
    return (
      <Text size="small" className="p-4 text-ui-fg-subtle">
        {emptyMessage}
      </Text>
    )
  }
  return null
}

export default ImageQueryState
