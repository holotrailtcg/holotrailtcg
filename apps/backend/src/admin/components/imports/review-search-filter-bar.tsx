import { Input, Select } from "@medusajs/ui"

export interface StatusOption {
  value: string
  label: string
}

interface ReviewSearchFilterBarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  statusValue: string
  onStatusChange: (value: string) => void
  statusOptions: StatusOption[]
  searchPlaceholder?: string
}

const ALL_STATUSES = "__all__"

const ReviewSearchFilterBar = ({
  searchValue,
  onSearchChange,
  statusValue,
  onStatusChange,
  statusOptions,
  searchPlaceholder = "Search by card name, set or number",
}: ReviewSearchFilterBarProps) => {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder}
        className="sm:max-w-xs"
      />
      <Select
        value={statusValue || ALL_STATUSES}
        onValueChange={(value) => onStatusChange(value === ALL_STATUSES ? "" : value)}
      >
        <Select.Trigger className="sm:max-w-xs">
          <Select.Value placeholder="All statuses" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value={ALL_STATUSES}>All statuses</Select.Item>
          {statusOptions.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
    </div>
  )
}

export default ReviewSearchFilterBar
