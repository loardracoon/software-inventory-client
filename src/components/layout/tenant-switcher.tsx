import { Building2, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTenant } from "@/features/tenants/tenant-context";

export function TenantSwitcher() {
  const { tenants, selectedTenantId, selectTenant } = useTenant();
  const selected = tenants.find((t) => t.id === selectedTenantId);
  const label = selected ? selected.name : "All tenants";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56" aria-label={`Tenant: ${label}. Change tenant`}>
          <Building2 aria-hidden="true" />
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Tenant</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => selectTenant(null)}>
          {selectedTenantId === null ? <Check aria-hidden="true" /> : <span className="size-4" />}
          All tenants
        </DropdownMenuItem>
        {tenants.length > 0 ? <DropdownMenuSeparator /> : null}
        {tenants.map((tenant) => (
          <DropdownMenuItem key={tenant.id} onSelect={() => selectTenant(tenant.id)}>
            {tenant.id === selectedTenantId ? <Check aria-hidden="true" /> : <span className="size-4" />}
            <span className="truncate">{tenant.name}</span>
          </DropdownMenuItem>
        ))}
        {tenants.length === 0 ? (
          <p className="m-0 px-2 py-1.5 text-xs text-text-muted">Tenants appear after the first Sophos Central sync.</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
