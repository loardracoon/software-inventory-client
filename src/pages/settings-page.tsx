import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { AlertsCard } from "@/features/alerts/alerts-card";
import { HubCard } from "@/features/dictionary/hub-card";
import { QueriesCard } from "@/features/queries/queries-card";
import { SophosConnectionCard } from "@/features/sophos/sophos-connection-card";
import { useTenant } from "@/features/tenants/tenant-context";
import { TenantsCard } from "@/features/tenants/tenants-card";

export function SettingsPage() {
  const { refreshTenants } = useTenant();
  const [syncCount, setSyncCount] = useState(0);

  return (
    <>
      <PageHeader eyebrow="Administration" title="Settings" description="Sophos connection, queries, dictionary and alerts." />
      <SophosConnectionCard
        onSynced={() => {
          setSyncCount((n) => n + 1);
          refreshTenants();
        }}
      />
      <TenantsCard refreshKey={syncCount} />
      <QueriesCard />
      <HubCard />
      <AlertsCard />
    </>
  );
}
