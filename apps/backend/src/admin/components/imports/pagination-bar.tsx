import { Button, Text } from "@medusajs/ui"

export interface PaginationBarProps {
  offset: number
  limit: number
  count: number
  onOffsetChange: (offset: number) => void
}

const PaginationBar = ({ offset, limit, count, onOffsetChange }: PaginationBarProps) => {
  if (count <= limit) {
    return null
  }

  const start = count === 0 ? 0 : offset + 1
  const end = Math.min(offset + limit, count)

  return (
    <div className="flex items-center justify-between p-4">
      <Text size="small" className="text-ui-fg-subtle">
        {start}-{end} of {count}
      </Text>
      <div className="flex gap-2">
        <Button
          size="small"
          variant="secondary"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={offset + limit >= count}
          onClick={() => onOffsetChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export default PaginationBar
