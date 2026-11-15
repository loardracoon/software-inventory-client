import { FileCheck2, ShieldAlert, History, LayoutDashboard, Monitor, Package, RefreshCw, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/computers", label: "Computers", icon: Monitor },
  { to: "/software", label: "Software", icon: Package },
  { to: "/policies", label: "Policies", icon: ShieldCheck },
  { to: "/remediation", label: "Remediation", icon: ShieldAlert },
  { to: "/changes", label: "Changes", icon: History },
  { to: "/scans", label: "Scans", icon: RefreshCw },
  { to: "/reports", label: "Reports", icon: FileCheck2 },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
];
