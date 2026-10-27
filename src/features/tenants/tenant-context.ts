import { createContext, useContext } from "react";

export type Tenant = { id: string; name: string };

export type TenantContextValue = {
  tenants: Tenant[];
  // null = all tenants the user can see.
  selectedTenantId: string | null;
  selectTenant: (tenantId: string | null) => void;
  // Reload the list, e.g. after a computer sync added tenants.
  refreshTenants: () => void;
};

export const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenant(): TenantContextValue {
  const value = useContext(TenantContext);
  if (!value) throw new Error("useTenant must be used inside TenantProvider");
  return value;
}
