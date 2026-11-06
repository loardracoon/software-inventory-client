import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string };

// A select you can type in: the button shows the choice, the list opens under it with a search box. Every word you type
// must appear in the option's label ("remote desk" finds "Remote access / Remote desktop and support"). Same props as
// NativeSelect, so a category picker changes in one line. Keyboard: arrows move, Enter chooses, Escape closes.
const CONTROL =
  "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-sm border-[1.5px] border-input bg-surface-raised px-3 text-left text-[15px] text-text-body focus-visible:border-action focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page focus-visible:outline-none disabled:opacity-60";

export function filterOptions(options: SearchOption[], query: string): SearchOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((o) => {
    const text = o.label.toLowerCase();
    return o.value !== "" && words.every((w) => text.includes(w));
  });
}

export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Search",
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  const selected = options.find((o) => o.value === value);

  function choose(option: SearchOption | undefined) {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function move(next: number) {
    const i = Math.max(0, Math.min(shown.length - 1, next));
    setActive(i);
    listRef.current?.children[i]?.scrollIntoView?.({ block: "nearest" });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        }
      }}
    >
      <PopoverTrigger asChild>
        <button id={id} type="button" role="combobox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-haspopup="listbox" disabled={disabled} className={CONTROL}>
          <span className={cn("truncate", !selected && "text-text-muted")}>{selected?.label.trim() ?? "Choose"}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-[var(--radix-popover-trigger-width)] min-w-64 max-w-none p-0">
        <div className="border-b border-border-subtle p-2">
          <input
            autoFocus
            type="search"
            role="searchbox"
            aria-label={placeholder}
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            placeholder={placeholder}
            value={query}
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-full rounded-sm border-[1.5px] border-input bg-surface-raised px-2 text-[14px] text-text-body focus-visible:border-action focus-visible:outline-none"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(active + 1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(active - 1);
              } else if (e.key === "Home") {
                e.preventDefault();
                move(0);
              } else if (e.key === "End") {
                e.preventDefault();
                move(shown.length - 1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(shown[active]);
              }
            }}
          />
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label="Options" className="m-0 max-h-64 list-none overflow-y-auto p-1">
          {shown.map((o, i) => (
            <li
              key={o.value || "__none"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-[14px] text-text-body",
                i === active && "bg-surface-subtle",
                o.value === value && "font-semibold text-text-strong",
              )}
            >
              <span>{o.label.trim()}</span>
              {o.value === value ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
            </li>
          ))}
          {shown.length === 0 ? <li role="presentation" className="px-2 py-3 text-[13px] text-text-muted">No match for “{query}”</li> : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
