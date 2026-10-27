import { Link } from "react-router";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export function NotFoundPage() {
  return (
    <>
      <PageHeader eyebrow="Error 404" title="Page not found" />
      <EmptyState
        icon={SearchX}
        title="This page does not exist"
        action={
          <Button asChild size="sm">
            <Link to="/">Go to Overview</Link>
          </Button>
        }
      />
    </>
  );
}
