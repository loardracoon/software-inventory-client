import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { Loader2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { useAuth } from "./auth-context";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "unconfigured") {
    return (
      <div className="mx-auto max-w-xl p-6 pt-24">
        <EmptyState
          title="Supabase is not configured"
          description="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local (see CLAUDE.md › Commands) and restart the dev server."
        />
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div role="status" className="flex min-h-svh items-center justify-center gap-3 text-text-muted">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        Loading
      </div>
    );
  }
  if (status === "signed_out") {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return children;
}
