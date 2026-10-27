import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerDataTable, type ServerColumnDef, type ServerPageRequest } from "./server-data-table";

type Row = { id: string; name: string };
type Filters = { platform: string | null };

const COLUMNS: ServerColumnDef<Row>[] = [{ accessorKey: "name", header: "Name" }];

function makeFetch(total: number) {
  return vi.fn(async ({ pageIndex, pageSize }: ServerPageRequest<Filters>) => {
    const start = pageIndex * pageSize;
    const rows = Array.from({ length: Math.max(0, Math.min(pageSize, total - start)) }, (_, i) => ({
      id: String(start + i),
      name: `Host ${start + i}`,
    }));
    return { rows, rowCount: total };
  });
}

function lastRequest(fetchPage: ReturnType<typeof makeFetch>) {
  return fetchPage.mock.calls.at(-1)![0];
}

describe("ServerDataTable", () => {
  it("requests one page from the server and renders it", async () => {
    const fetchPage = makeFetch(60);
    render(<ServerDataTable label="Hosts" columns={COLUMNS} fetchPage={fetchPage} filters={{ platform: null }} />);

    expect(await screen.findByText("Host 0")).toBeInTheDocument();
    expect(screen.getByText("1–25 of 60")).toBeInTheDocument();
    expect(lastRequest(fetchPage)).toMatchObject({ pageIndex: 0, pageSize: 25, sorting: [], filters: { platform: null } });
  });

  it("pages and sorts on the server", async () => {
    const user = userEvent.setup();
    const fetchPage = makeFetch(60);
    render(<ServerDataTable label="Hosts" columns={COLUMNS} fetchPage={fetchPage} filters={{ platform: null }} />);
    await screen.findByText("Host 0");

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Host 25")).toBeInTheDocument();
    expect(lastRequest(fetchPage)).toMatchObject({ pageIndex: 1 });

    await user.click(screen.getByRole("button", { name: /Name/ }));
    await waitFor(() => expect(lastRequest(fetchPage).sorting).toEqual([{ id: "name", desc: false }]));
  });

  it("goes back to the first page when filters change", async () => {
    const user = userEvent.setup();
    const fetchPage = makeFetch(60);
    const { rerender } = render(
      <ServerDataTable label="Hosts" columns={COLUMNS} fetchPage={fetchPage} filters={{ platform: null }} />,
    );
    await screen.findByText("Host 0");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Host 25");

    rerender(<ServerDataTable label="Hosts" columns={COLUMNS} fetchPage={fetchPage} filters={{ platform: "linux" }} />);
    await waitFor(() => expect(lastRequest(fetchPage)).toMatchObject({ pageIndex: 0, filters: { platform: "linux" } }));
  });

  it("shows the empty state and server errors", async () => {
    const { unmount } = render(
      <ServerDataTable label="Hosts" columns={COLUMNS} fetchPage={makeFetch(0)} filters={{ platform: null }} />,
    );
    expect(await screen.findByText("No results")).toBeInTheDocument();
    unmount();

    const failing = vi.fn(async () => {
      throw new Error("permission denied for table computers");
    });
    render(<ServerDataTable label="Hosts" columns={COLUMNS} fetchPage={failing} filters={{ platform: null }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied for table computers");
  });
});
