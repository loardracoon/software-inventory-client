import type { ReactNode } from "react";
import { Eyebrow } from "./eyebrow";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
        <Eyebrow tone="brand" tick>
          {eyebrow}
        </Eyebrow>
        <h1 className="m-0 text-[28px] sm:text-4xl">{title}</h1>
        {description ? <p className="m-0 text-sm text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
