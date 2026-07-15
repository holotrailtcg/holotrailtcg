import { Table, Text } from "@medusajs/ui"
import type { ReactNode } from "react"

export interface ReviewTableColumn<T> {
  header: string
  cell: (row: T) => ReactNode
}

interface ReviewTableProps<T> {
  columns: ReviewTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  isLoading: boolean
  isError: boolean
  emptyMessage: string
  errorMessage?: string
}

function ReviewTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isLoading,
  isError,
  emptyMessage,
  errorMessage = "This could not be loaded. Please try again.",
}: ReviewTableProps<T>) {
  if (isLoading) {
    return (
      <Text size="small" className="p-4 text-ui-fg-subtle">
        Loading…
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

  if (rows.length === 0) {
    return (
      <Text size="small" className="p-4 text-ui-fg-subtle">
        {emptyMessage}
      </Text>
    )
  }

  return (
    <Table>
      <Table.Header>
        <Table.Row>
          {columns.map((column) => (
            <Table.HeaderCell key={column.header}>{column.header}</Table.HeaderCell>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row
            key={rowKey(row)}
            className={onRowClick ? "cursor-pointer" : undefined}
            onClick={() => onRowClick?.(row)}
          >
            {columns.map((column) => (
              <Table.Cell key={column.header}>{column.cell(row)}</Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  )
}

export default ReviewTable
