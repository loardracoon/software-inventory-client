import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
};

export function EmptyState({ title, description, icon: Icon = Inbox, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-surface-raised px-6 py-12 text-center">
      <Icon className="size-8 text-text-muted" aria-hidden="true" strokeWidth={1.5} />
      <h2 className="m-0 text-lg">{title}</h2>
      {description ? <p className="m-0 max-w-md text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
