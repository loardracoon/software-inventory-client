import { ArrowUpCircle, MinusCircle, PlusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CategoryOrigin } from "./category-tag";

// Change type as a word and an icon, never colour alone.
export function ChangeBadge({ change }: { change: string | null }) {
  if (change === "added") {
    return (
      <Badge color="safe" soft>
        <PlusCircle aria-hidden="true" />
        Added
      </Badge>
    );
  }
  if (change === "removed") {
    return (
      <Badge color="critical" soft>
        <MinusCircle aria-hidden="true" />
        Removed
      </Badge>
    );
  }
  return (
    <Badge color="info" soft>
      <ArrowUpCircle aria-hidden="true" />
      Updated
    </Badge>
  );
}

export function toCategoryOrigin(origin: string | null, method: string | null, confidence: number | null): CategoryOrigin {
  if (origin === "local_override") return { source: "local_override" };
  if (origin === "hub") {
    if ((method === "jev" || method === "jev_auto") && confidence !== null) return { source: "hub", method: "jev", confidence: Number(confidence) };
    return { source: "hub", method: "reviewed" };
  }
  return { source: "unclassified" };
}
