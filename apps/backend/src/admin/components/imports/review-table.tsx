import { Table, Text } from "@medusajs/ui"
import type { ReactNode } from "react"

export interface ReviewTableColumn<T> {
  header: string
  /** Overrides the rendered header cell content (e.g. a select-all checkbox) while `header` still supplies the column's stable key. */
  headerCell?: ReactNode
  cell: (row: T) => ReactNode
}

interface ReviewTableProps<T> {
  columns: ReviewTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /** Optional per-row background tint, e.g. by severity. Returned classes are appended alongside the default row classes. */
  rowClassName?: (row: T) => string | undefined
  isLoading: boolean
  isError: boolean
  emptyMessage: string
  errorMessage?: string
  className?: string
}

function ReviewTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  isLoading,
  isError,
  emptyMessage,
  errorMessage = "This could not be loaded. Please try again.",
  className,
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
    <Table className={className}>
      <Table.Header>
        <Table.Row>
          {columns.map((column) => (
            <Table.HeaderCell key={column.header}>{column.headerCell ?? column.header}</Table.HeaderCell>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row
            key={rowKey(row)}
            className={[onRowClick ? "cursor-pointer" : "", rowClassName?.(row) ?? ""].filter(Boolean).join(" ") || undefined}
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
