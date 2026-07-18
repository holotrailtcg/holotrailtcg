import { useEffect, useRef } from "react"

interface SelectAllCheckboxProps {
  state: "none" | "some" | "all"
  onToggle: () => void
  ariaLabel: string
}

/** Plain HTML checkboxes only expose `indeterminate` imperatively via a ref — it is not a JSX attribute. */
const SelectAllCheckbox = ({ state, onToggle, ariaLabel }: SelectAllCheckboxProps) => {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some"
  }, [state])

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={state === "all"}
      onChange={onToggle}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

export default SelectAllCheckbox
