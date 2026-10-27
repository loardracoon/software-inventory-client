import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportCsv, useCanContribute, type ExportDataset } from "./api";

// "Export CSV" with the screen's current filters. The file is built and audited by the server;
// hidden for viewers, who cannot export.
export function ExportButton({ dataset, filters, label = "Export CSV" }: { dataset: ExportDataset; filters: object; label?: string }) {
  const canExport = useCanContribute();
  const [busy, setBusy] = useState(false);
  if (!canExport) return null;

  async function run() {
    setBusy(true);
    try {
      await exportCsv(dataset, filters);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void run()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
      {label}
    </Button>
  );
}
