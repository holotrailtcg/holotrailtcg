interface CardImageThumbnailProps {
  imageUrl: string | null
  alt: string
  onClick?: () => void
  title?: string
}

/**
 * Small square image used in review tables: the matched card's real photo
 * or TCGdex reference art if either exists, otherwise a placeholder. Always
 * clickable when `onClick` is provided — the caller decides what that means
 * (replace an existing image, or create the card first).
 */
const CardImageThumbnail = ({ imageUrl, alt, onClick, title }: CardImageThumbnailProps) => {
  const className = "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border bg-ui-bg-subtle"

  const content = imageUrl ? (
    <img src={imageUrl} alt={alt} className="h-full w-full object-contain" />
  ) : (
    <span aria-hidden="true" className="text-ui-fg-muted text-lg">
      🂠
    </span>
  )

  if (!onClick) {
    // Even with nothing to do here, the click must not silently bubble up
    // to an ancestor's row-click handler (e.g. a review table opening its
    // detail drawer instead of this being a no-op).
    return (
      <div className={className} title={title} onClick={(event) => event.stopPropagation()}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`${className} cursor-pointer hover:opacity-80`}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={alt}
      title={title}
    >
      {content}
    </button>
  )
}

export default CardImageThumbnail
