import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * `cn` merges conditional class names (clsx) and resolves conflicting Tailwind
 * utilities (tailwind-merge). This is the shadcn-pattern class helper used by
 * the Holo Trail design-system components in `components/`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
