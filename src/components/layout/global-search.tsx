import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

// Routes to /software?q=. Searching happens on the server (Phase 6).
export function GlobalSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const currentQuery = location.pathname === "/software" ? (params.get("q") ?? "") : "";
  const [draft, setDraft] = useState<{ base: string; value: string }>({ base: currentQuery, value: currentQuery });
  const value = draft.base === currentQuery ? draft.value : currentQuery;

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = value.trim();
    navigate(q ? `/software?q=${encodeURIComponent(q)}` : "/software");
  }

  return (
    <form role="search" onSubmit={submit} className="relative w-full">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
      <Input
        type="search"
        aria-label="Search the inventory"
        placeholder="Search computers, software or extension IDs"
        className="pl-10"
        value={value}
        onChange={(event) => setDraft({ base: currentQuery, value: event.target.value })}
      />
    </form>
  );
}
