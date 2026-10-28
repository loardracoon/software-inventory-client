import { LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, type AppRole } from "@/features/auth/auth-context";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", operator: "Operator", viewer: "Viewer" };

function initials(text: string): string {
  const name = text.split("@")[0];
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function UserMenu() {
  const { user, profile, signOut } = useAuth();
  const email = profile?.email ?? user?.email ?? "";
  const name = profile?.display_name ?? email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-sophos-blue text-[13px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {initials(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1.5 font-normal">
          <span className="truncate text-sm text-text-strong">{name}</span>
          {name !== email ? <span className="truncate text-xs text-text-muted">{email}</span> : null}
          {profile ? (
            <Badge color="blue" soft>
              {ROLE_LABEL[profile.role]}
            </Badge>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
