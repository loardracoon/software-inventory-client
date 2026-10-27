import { useCallback } from "react";
import { Link, useLocation } from "react-router";
import { Bookmark, EllipsisVertical, Users } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/auth-context";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { deleteSearch, fetchSavedSearches, searchHref, setPinned, useSavedSearchesChanged, type SavedSearch } from "./api";

// Pinned saved searches in the sidebar: the user's own and the shared ones.
export function SavedSearchNav({ onNavigate }: { onNavigate?: () => void }) {
  const { profile } = useAuth();
  const searches = useLoad(`saved-searches:${profile?.id ?? ""}`, fetchSavedSearches);
  const reload = searches.reload;
  useSavedSearchesChanged(useCallback(() => reload(), [reload]));
  const location = useLocation();
  const pinned = (searches.data ?? []).filter((s) => s.pinned);
  if (pinned.length === 0) return null;

  const canEdit = (s: SavedSearch) => s.owner_id === profile?.id || (s.owner_id === null && profile?.role === "admin");
  const run = async (action: Promise<void>, done: string) => {
    try {
      await action;
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the saved search");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="px-3 text-xs font-semibold tracking-wide text-neutral-400 uppercase">Saved searches</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {pinned.map((s) => {
          const href = searchHref(s);
          const active = `${location.pathname}${location.search}` === href;
          return (
            <li key={s.id} className="group flex items-center">
              <Link
                to={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-sm px-3 text-sm no-underline transition-colors focus-visible:outline-cyber-blue",
                  active ? "bg-cyber-blue/12 font-semibold text-cyber-blue" : "text-neutral-300 hover:bg-white/6 hover:text-white",
                )}
              >
                {s.owner_id === null ? <Users className="size-4 shrink-0" aria-label="Shared" strokeWidth={1.5} /> : <Bookmark className="size-4 shrink-0" aria-hidden="true" strokeWidth={1.5} />}
                <span className="truncate">{s.name}</span>
              </Link>
              {canEdit(s) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Options for ${s.name}`}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-neutral-400 hover:bg-white/6 hover:text-white focus-visible:outline-cyber-blue"
                  >
                    <EllipsisVertical className="size-4" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void run(setPinned(s.id, false), `“${s.name}” unpinned`)}>Unpin</DropdownMenuItem>
                    <DropdownMenuItem className="text-text-critical" onSelect={() => void run(deleteSearch(s.id), `“${s.name}” deleted`)}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
