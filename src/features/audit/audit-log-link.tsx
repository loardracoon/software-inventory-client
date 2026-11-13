import { Link } from "react-router";
import { ScrollText } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";

// Settings entry to the audit log; admins only.
export function AuditLogLink() {
  const { profile } = useAuth();
  if (profile?.role !== "admin") return null;
  return (
    <Link to="/settings/audit-log" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-action hover:underline">
      <ScrollText className="size-4" aria-hidden="true" />
      Audit log
    </Link>
  );
}
