import { Ban, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/integrations/supabase/types";

export type AttentionLevel = Database["public"]["Enums"]["attention_level"];

export type CategoryRef = {
  level1: string;
  level2: string;
  attention: AttentionLevel;
};

export type CategoryOrigin =
  | { source: "hub"; method: "reviewed" }
  | { source: "hub"; method: "jev"; confidence: number }
  | { source: "local_override" }
  | { source: "unclassified" };

export function formatCategoryOrigin(origin: CategoryOrigin): string {
  switch (origin.source) {
    case "hub":
      return origin.method === "jev" ? `Hub · Jev ${origin.confidence.toFixed(2)}` : "Hub · reviewed";
    case "local_override":
      return "Local override";
    case "unclassified":
      return "Unclassified";
  }
}

// Category of a view row (title_classification columns); null when unclassified.
export function categoryFromRow(row: { level1_name?: string | null; level2_name?: string | null; attention_level?: AttentionLevel | null }): CategoryRef | null {
  if (!row.level2_name) return null;
  return { level1: row.level1_name ?? "", level2: row.level2_name, attention: row.attention_level ?? "info" };
}

type CategoryTagProps = {
  // null = no dictionary match yet.
  category: CategoryRef | null;
  origin?: CategoryOrigin;
  // false where an Attention column shows it as an icon.
  showAttention?: boolean;
};

// Level 1 small and muted above level 2; attention badge for Review and Not allowed only.
export function CategoryTag({ category, origin, showAttention = true }: CategoryTagProps) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {category ? (
        <>
          <span className="text-xs text-text-muted">{category.level1}</span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-text-strong">
            {category.level2}
            {showAttention ? <AttentionBadge level={category.attention} /> : null}
          </span>
        </>
      ) : (
        <span className="text-sm text-text-muted">Unclassified (sent to hub)</span>
      )}
      {origin ? <span className="text-xs text-text-muted">{formatCategoryOrigin(origin)}</span> : null}
    </div>
  );
}

export function AttentionBadge({ level }: { level: AttentionLevel }) {
  if (level === "review") {
    return (
      <Badge color="high">
        <Eye aria-hidden="true" />
        Review
      </Badge>
    );
  }
  if (level === "not_allowed") {
    return (
      <Badge color="critical">
        <Ban aria-hidden="true" />
        Not allowed
      </Badge>
    );
  }
  return null;
}
