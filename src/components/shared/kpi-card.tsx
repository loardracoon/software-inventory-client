import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow } from "./eyebrow";

type KpiCardProps = {
  label: string;
  value: ReactNode;
  unit?: string;
  description?: ReactNode;
  loading?: boolean;
};

export function KpiCard({ label, value, unit, description, loading = false }: KpiCardProps) {
  return (
    <Card className="min-h-[118px] gap-2.5 px-6">
      <Eyebrow>{label}</Eyebrow>
      {loading ? (
        <Skeleton className="h-10 w-24" />
      ) : (
        <div className="font-display text-[40px] leading-none tracking-[-0.01em] text-text-strong">
          {value}
          {unit ? <span className="text-[22px]">{unit}</span> : null}
        </div>
      )}
      {description ? <p className="m-0 text-[13px] text-text-muted">{description}</p> : null}
    </Card>
  );
}
