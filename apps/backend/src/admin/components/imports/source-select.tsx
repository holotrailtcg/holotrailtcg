import { Label, Select, Text } from "@medusajs/ui"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { fetchJson } from "./fetch-json"
import type { InventorySourceListResponse } from "./pulse-import-types"

interface SourceSelectProps {
  value: string
  onChange: (value: string) => void
}

/** Active inventory sources only — an archived source can never receive a new import. */
const SourceSelect = ({ value, onChange }: SourceSelectProps) => {
  const query = useQuery({
    queryKey: ["inventory-sources", { status: "ACTIVE" }],
    queryFn: () => fetchJson<InventorySourceListResponse>("/admin/trading-card-inventory/sources?status=ACTIVE&limit=100"),
    placeholderData: keepPreviousData,
  })

  const sources = query.data?.sources ?? []

  if (query.isLoading) {
    return <Text size="small" className="text-ui-fg-subtle">Loading sources…</Text>
  }

  if (query.isError) {
    return <Text size="small" className="text-ui-fg-error">Sources could not be loaded.</Text>
  }

  if (sources.length === 0) {
    return <Text size="small" className="text-ui-fg-subtle">No active inventory sources yet. Create a new one below.</Text>
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="inventory-source">Inventory source</Label>
      <Select value={value} onValueChange={onChange}>
        <Select.Trigger id="inventory-source">
          <Select.Value placeholder="Choose an inventory source" />
        </Select.Trigger>
        <Select.Content>
          {sources.map((source) => (
            <Select.Item key={source.id} value={source.id}>
              {source.displayName}{source.language ? ` (${source.language})` : ""}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
    </div>
  )
}

export default SourceSelect
