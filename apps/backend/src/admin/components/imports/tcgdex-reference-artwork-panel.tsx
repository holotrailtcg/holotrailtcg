import { Container, Text } from "@medusajs/ui"

interface TcgdexReferenceArtworkPanelProps {
  url: string | null
  cardName: string
}

/**
 * A visually and structurally separate panel from any Holo Trail
 * photograph gallery. TCGdex artwork is reference-only and can never
 * become the real listing image.
 */
const TcgdexReferenceArtworkPanel = ({ url, cardName }: TcgdexReferenceArtworkPanelProps) => {
  return (
    <Container className="flex flex-col items-center gap-2 p-4">
      <Text size="small" weight="plus">
        TCGdex reference artwork
      </Text>
      <Text size="xsmall" className="text-ui-fg-subtle">
        Reference only — not a Holo Trail photograph
      </Text>
      {url ? (
        <img src={url} alt={`${cardName} reference artwork from TCGdex`} className="max-h-64 w-auto border" />
      ) : (
        <Text size="small" className="text-ui-fg-subtle">
          No TCGdex reference available
        </Text>
      )}
    </Container>
  )
}

export default TcgdexReferenceArtworkPanel
