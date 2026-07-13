import * as React from "react"

import { cn } from "@lib/utils"
import { Label } from "@components/ui/label"

export interface FormFieldRenderProps {
  /** Wire this onto the control's `id`. */
  id: string
  /** Wire this onto the control's `aria-describedby`. */
  describedBy: string | undefined
  /** Wire this onto the control's `aria-invalid`. */
  invalid: boolean
  /** Convenience: control is in an error state. */
  hasError: boolean
}

export interface FormFieldProps {
  /** Stable id used to link the label, control, help text and error. */
  id: string
  label: string
  required?: boolean
  helpText?: string
  /** When set, the field renders its error and marks the control invalid. */
  error?: string
  className?: string
  /**
   * Render the control, wiring the supplied a11y props so the label, help text
   * and error message are correctly associated.
   */
  children: (props: FormFieldRenderProps) => React.ReactNode
}

/**
 * Holo Trail form-field wrapper: label, required indicator, help text and
 * validation error with correct `aria-describedby` / `aria-invalid` wiring.
 * It is control-agnostic and adds no form library.
 */
function FormField({
  id,
  label,
  required,
  helpText,
  error,
  className,
  children,
}: FormFieldProps) {
  const helpId = helpText ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy =
    [helpId, errorId].filter(Boolean).join(" ") || undefined

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>

      {children({
        id,
        describedBy,
        invalid: Boolean(error),
        hasError: Boolean(error),
      })}

      {helpText && (
        <p id={helpId} className="ht-caption">
          {helpText}
        </p>
      )}

      {error && (
        <p id={errorId} className="ht-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export { FormField }
