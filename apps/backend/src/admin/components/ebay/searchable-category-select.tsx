import { Input } from "@medusajs/ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildCategoryTree, flattenCategoryTree, type StoreCategoryLike } from "./category-tree";

/**
 * A text input with an in-DOM, theme-matched dropdown of active categories,
 * ordered and indented the same way the Store Categories hierarchy page
 * shows them (parents before children, siblings by their configured order).
 * Typing filters the list by name or path. Replaces an earlier
 * `<datalist>`-based version: native datalist popups are rendered by the
 * browser/OS outside the page's DOM, so they can't be styled or reliably
 * positioned — confirmed broken (floating off to the side of the viewport)
 * in real testing.
 */
export function SearchableCategorySelect<T extends StoreCategoryLike>({
  id,
  ariaLabel,
  categories,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  ariaLabel: string;
  categories: T[];
  value: string;
  onChange: (categoryId: string) => void;
  placeholder?: string;
}) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const ordered = useMemo(
    () => flattenCategoryTree(buildCategoryTree(categories.filter((c) => c.status === "ACTIVE"))),
    [categories],
  );
  const labelById = useMemo(() => new Map(ordered.map((c) => [c.id, c.name])), [ordered]);
  const selectedLabel = labelById.get(value) ?? "";
  const [text, setText] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (!open) setText(selectedLabel);
  }, [selectedLabel, open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const query = text.trim().toLowerCase();
    if (!query) return ordered;
    return ordered.filter((c) => c.name.toLowerCase().includes(query) || c.path.toLowerCase().includes(query));
  }, [ordered, text]);

  const selectOption = (category: T & { depth: number }) => {
    onChange(category.id);
    setText(category.name);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        role="combobox"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onFocus={() => {
          setOpen(true);
          setText("");
          setHighlightedIndex(0);
        }}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setHighlightedIndex(0);
        }}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightedIndex((index) => Math.min(index + 1, filtered.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightedIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const match = filtered[highlightedIndex];
            if (match) selectOption(match);
          } else if (event.key === "Escape") {
            setOpen(false);
            setText(selectedLabel);
          }
        }}
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="bg-ui-bg-base border-ui-border-base absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-md border shadow-lg"
        >
          {filtered.length === 0 && (
            <li className="text-ui-fg-subtle px-3 py-2 text-sm">No categories match.</li>
          )}
          {filtered.map((category, index) => (
            <li
              key={category.id}
              role="option"
              aria-selected={category.id === value}
              onMouseDown={(event) => { event.preventDefault(); selectOption(category); }}
              onMouseEnter={() => setHighlightedIndex(index)}
              style={{ paddingLeft: `${0.75 + category.depth * 1}rem` }}
              className={`cursor-pointer px-3 py-1.5 text-sm ${
                index === highlightedIndex ? "bg-ui-bg-base-hover text-ui-fg-base" : "text-ui-fg-subtle"
              } ${category.id === value ? "font-medium text-ui-fg-base" : ""}`}
            >
              {category.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
