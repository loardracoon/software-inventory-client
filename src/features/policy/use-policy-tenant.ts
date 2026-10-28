import { useCallback, useMemo } from "react";
import { useTenant } from "@/features/tenants/tenant-context";

// A policy belongs to one tenant: the selected one, or the only one the user can see.
export function usePolicyTenant(): { tenantId: string | null; needsSelection: boolean } {
  const { tenants, selectedTenantId } = useTenant();
  const tenantId = selectedTenantId ?? (tenants.length === 1 ? tenants[0].id : null);
  return { tenantId, needsSelection: tenantId === null && tenants.length > 1 };
}

// Rule conditions store category slugs; show their names.
export function useCategoryName(rows: { slug: string; name: string }[] | null): (slug: string) => string {
  const names = useMemo(() => new Map((rows ?? []).map((r) => [r.slug, r.name])), [rows]);
  return useCallback((slug: string) => names.get(slug) ?? slug, [names]);
}
