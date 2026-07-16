const POSITIONS: { x: number; y: number; label: string }[] = [
  { x: 0, y: 0, label: "Top left" },
  { x: 0.5, y: 0, label: "Top centre" },
  { x: 1, y: 0, label: "Top right" },
  { x: 0, y: 0.5, label: "Centre left" },
  { x: 0.5, y: 0.5, label: "Centre" },
  { x: 1, y: 0.5, label: "Centre right" },
  { x: 0, y: 1, label: "Bottom left" },
  { x: 0.5, y: 1, label: "Bottom centre" },
  { x: 1, y: 1, label: "Bottom right" },
]

export interface FocalPosition {
  x: number
  y: number
}

interface FocalPositionSelectorProps {
  value: FocalPosition
  onChange: (position: FocalPosition) => void
}

const FocalPositionSelector = ({ value, onChange }: FocalPositionSelectorProps) => {
  return (
    <div className="grid grid-cols-3 gap-1" role="group" aria-label="Focal position">
      {POSITIONS.map((position) => {
        const selected = position.x === value.x && position.y === value.y
        return (
          <button
            key={position.label}
            type="button"
            aria-label={position.label}
            aria-pressed={selected}
            onClick={() => onChange({ x: position.x, y: position.y })}
            className={
              selected
                ? "border-2 border-ui-fg-interactive bg-ui-bg-highlight p-3 text-xs"
                : "border p-3 text-xs"
            }
          >
            {selected ? `${position.label} (selected)` : position.label}
          </button>
        )
      })}
    </div>
  )
}

export default FocalPositionSelector
