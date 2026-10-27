// Saved /software searches: personal (owner = the user) or shared by an admin (owner null).
// params are the /software URL parameters, so a saved search is just a link.

import { useEffect } from "react";
import type { Database } from "@/integrations/supabase/types";
import { db, orThrow } from "@/lib/supabase-query";

export type SavedSearch = Database["public"]["Tables"]["saved_searches"]["Row"];

const CHANGED = "saved-searches-changed";

export function searchHref(search: Pick<SavedSearch, "params">): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries((search.params ?? {}) as Record<string, unknown>)) {
    if (typeof value === "string" && value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/software?${query}` : "/software";
}

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  return orThrow(await db().from("saved_searches").select("*").order("owner_id", { nullsFirst: true }).order("name")) ?? [];
}

export async function saveSearch(name: string, params: URLSearchParams, shared: boolean, userId: string): Promise<void> {
  orThrow(
    await db()
      .from("saved_searches")
      .insert({ name: name.trim(), params: Object.fromEntries(params.entries()), owner_id: shared ? null : userId, pinned: true }),
  );
  window.dispatchEvent(new Event(CHANGED));
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  orThrow(await db().from("saved_searches").update({ pinned }).eq("id", id));
  window.dispatchEvent(new Event(CHANGED));
}

export async function deleteSearch(id: string): Promise<void> {
  orThrow(await db().from("saved_searches").delete().eq("id", id));
  window.dispatchEvent(new Event(CHANGED));
}

// Calls onChange whenever a search is saved, pinned or removed anywhere in the app.
export function useSavedSearchesChanged(onChange: () => void) {
  useEffect(() => {
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [onChange]);
}
