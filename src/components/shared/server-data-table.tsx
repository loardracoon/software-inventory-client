import { useEffect, useState, type ReactNode } from "react";
import {
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "./empty-state";

export const serverTableFeatures = tableFeatures({ rowPaginationFeature, rowSortingFeature });
export type ServerTableFeatures = typeof serverTableFeatures;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns mix value types
export type ServerColumnDef<TData extends RowData> = ColumnDef<ServerTableFeatures, TData, any>;

export type ServerPageRequest<TFilters> = {
  pageIndex: number;
  pageSize: number;
  sorting: SortingState;
  filters: TFilters;
  signal: AbortSignal;
};

export type ServerPage<TData> = { rows: TData[]; rowCount: number };

type ServerDataTableProps<TData extends RowData, TFilters> = {
  // Keep columns at module scope (or memoized); keep fetchPage stable with useCallback.
  columns: ServerColumnDef<TData>[];
  fetchPage: (request: ServerPageRequest<TFilters>) => Promise<ServerPage<TData>>;
  filters: TFilters;
  label: string;
  getRowId?: (row: TData) => string;
  initialSorting?: SortingState;
  pageSizeOptions?: number[];
  empty?: ReactNode;
};

type Result<TData> = { key: string; rows: TData[]; rowCount: number; error: string | null };

const NO_SORTING: SortingState = [];
const DEFAULT_PAGE_SIZES = [25, 50, 100];

// Paging, sorting and filtering all happen on the server: the table only renders one page.
export function ServerDataTable<TData extends RowData, TFilters>({
  columns,
  fetchPage,
  filters,
  label,
  getRowId,
  initialSorting = NO_SORTING,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  empty,
}: ServerDataTableProps<TData, TFilters>) {
  const filtersKey = JSON.stringify(filters);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: pageSizeOptions[0] });
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [seenFiltersKey, setSeenFiltersKey] = useState(filtersKey);
  const [result, setResult] = useState<Result<TData> | null>(null);

  // New filters go back to the first page.
  if (seenFiltersKey !== filtersKey) {
    setSeenFiltersKey(filtersKey);
    if (pagination.pageIndex !== 0) setPagination({ ...pagination, pageIndex: 0 });
  }

  const requestKey = JSON.stringify([filtersKey, pagination, sorting]);

  useEffect(() => {
    const controller = new AbortController();
    fetchPage({ ...pagination, sorting, filters: JSON.parse(filtersKey) as TFilters, signal: controller.signal })
      .then((page) => setResult({ key: requestKey, rows: page.rows, rowCount: page.rowCount, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Could not load this page.";
        setResult((previous) => ({ key: requestKey, rows: previous?.rows ?? [], rowCount: previous?.rowCount ?? 0, error: message }));
      });
    return () => controller.abort();
  }, [fetchPage, filtersKey, pagination, sorting, requestKey]);

  const loading = result?.key !== requestKey;
  const rows = result?.rows ?? (EMPTY as TData[]);
  const rowCount = result?.rowCount ?? 0;

  const table = useTable({
    features: serverTableFeatures,
    columns,
    data: rows,
    getRowId: getRowId ? (row: TData) => getRowId(row) : undefined,
    rowCount,
    manualPagination: true,
    manualSorting: true,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
  });

  const pageCount = Math.max(1, Math.ceil(rowCount / pagination.pageSize));
  const firstRow = rowCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const lastRow = Math.min(rowCount, (pagination.pageIndex + 1) * pagination.pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
        <Table aria-label={label} aria-busy={loading}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 uppercase"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!loading && rows.length === 0 && !result?.error ? (
          <div className="p-4">{empty ?? <EmptyState title="No results" description="Nothing matches these filters." />}</div>
        ) : null}
        {result?.error ? (
          <p role="alert" className="m-0 border-t border-border-subtle px-4 py-3 text-sm text-text-critical">
            {result.error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
        <span className="inline-flex items-center gap-2" aria-live="polite">
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {loading ? "Loading" : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${rowCount.toLocaleString()}`}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2">
            Rows per page
            <select
              className="h-9 rounded-sm border-[1.5px] border-border-control bg-surface-raised px-2 text-text-body"
              value={pagination.pageSize}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span>
            Page {pagination.pageIndex + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={loading || !table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={loading || !table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

const EMPTY: unknown[] = [];
