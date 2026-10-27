import { CircleAlert } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { fetchHubStatus } from "./api";

// Scans page: the hub is unreachable or failing; titles keep the categories already in the cache.
export function HubDelayedBanner() {
  const { data } = useLoad("hub-status", fetchHubStatus);
  if (!data?.delayed) return null;
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-alert-orange/40 bg-alert-orange/12 px-4 py-3 text-sm text-text-strong">
      <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <span>
        <strong>Dictionary sync delayed.</strong> Categories come from the last successful sync
        {data.synced_at ? ` (${formatDateTime(data.synced_at)})` : ""}. The collector retries with backoff
        {data.next_attempt_at ? `; next attempt ${formatDateTime(data.next_attempt_at)}` : ""}.
      </span>
    </div>
  );
}
