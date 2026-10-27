import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/auth-context";
import { TenantContext, type Tenant } from "./tenant-context";

const STORAGE_KEY = "endpoint-inventory.tenant";
const NO_TENANTS: Tenant[] = [];
// The switcher lists at most this many tenants; RLS returns only the ones the user can see.
const MAX_TENANTS = 1000;

function readStoredTenant(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Loads the tenants the signed-in user can see. Pass `tenants` to skip loading (tests).
export function TenantProvider({ children, tenants: fixedTenants }: { children: ReactNode; tenants?: Tenant[] }) {
  const { status, user } = useAuth();
  const [loaded, setLoaded] = useState<{ userId: string; tenants: Tenant[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [storedId, setStoredId] = useState<string | null>(readStoredTenant);
  const userId = status === "signed_in" ? (user?.id ?? null) : null;

  useEffect(() => {
    if (fixedTenants || !supabase || !userId) return;
    let active = true;
    supabase
      .from("tenants")
      .select("id, name")
      .order("name")
      .limit(MAX_TENANTS)
      .then(({ data }) => {
        if (active) setLoaded({ userId, tenants: data ?? [] });
      });
    return () => {
      active = false;
    };
  }, [fixedTenants, userId, version]);

  const tenants = fixedTenants ?? (loaded && loaded.userId === userId ? loaded.tenants : NO_TENANTS);
  const selectedTenantId = tenants.some((t) => t.id === storedId) ? storedId : null;
  const refreshTenants = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(
    () => ({
      tenants,
      selectedTenantId,
      refreshTenants,
      selectTenant: (tenantId: string | null) => {
        setStoredId(tenantId);
        try {
          if (tenantId) localStorage.setItem(STORAGE_KEY, tenantId);
          else localStorage.removeItem(STORAGE_KEY);
        } catch {
          // Not persisted when storage is blocked.
        }
      },
    }),
    [tenants, selectedTenantId, refreshTenants],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
