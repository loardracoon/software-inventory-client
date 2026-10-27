import { Link } from "react-router";
import { CategoryTag, categoryFromRow } from "@/components/shared/category-tag";
import { ChangeBadge } from "@/components/shared/change-badge";
import type { ServerColumnDef } from "@/components/shared/server-data-table";
import { formatDateTime } from "@/lib/format";
import type { ChangeRow } from "./api";

const detected: ServerColumnDef<ChangeRow> = { accessorKey: "detected_at", header: "Detected", cell: ({ getValue }) => formatDateTime(getValue() as string) };
const computer: ServerColumnDef<ChangeRow> = {
  accessorKey: "hostname",
  header: "Computer",
  cell: ({ row }) => <Link to={`/computers/${row.original.computer_id}`}>{row.original.hostname}</Link>,
};
const change: ServerColumnDef<ChangeRow> = { accessorKey: "change", header: "Change", cell: ({ getValue }) => <ChangeBadge change={getValue() as string} /> };
const title: ServerColumnDef<ChangeRow> = {
  accessorKey: "canonical_name",
  header: "Title",
  cell: ({ row }) => <Link to={`/software/${row.original.title_id}`}>{row.original.canonical_name}</Link>,
};
const version: ServerColumnDef<ChangeRow> = {
  id: "version",
  header: "Version",
  enableSorting: false,
  cell: ({ row }) => `${row.original.from_version ?? "—"} → ${row.original.to_version ?? "—"}`,
};
const category: ServerColumnDef<ChangeRow> = {
  accessorKey: "level2_name",
  header: "Category",
  enableSorting: false,
  cell: ({ row }) => <CategoryTag category={categoryFromRow(row.original)} />,
};

// Computer page (no computer column); Changes and title pages (with it).
export const CHANGE_COLUMNS: ServerColumnDef<ChangeRow>[] = [detected, change, title, version, category];
export const CHANGE_COLUMNS_WITH_COMPUTER: ServerColumnDef<ChangeRow>[] = [detected, computer, change, title, version, category];
