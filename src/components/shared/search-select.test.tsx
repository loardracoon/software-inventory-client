import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { filterOptions, SearchSelect } from "./search-select";

const options = [
  { value: "", label: "All categories" },
  { value: "remote-access", label: "Remote access" },
  { value: "remote-access/remote-desktop-and-support", label: "   Remote access / Remote desktop and support" },
  { value: "p2p/torrent-clients", label: "   P2P / Torrent clients" },
];

function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="cat">Category</label>
      <SearchSelect id="cat" value={value} onChange={setValue} options={options} placeholder="Search categories" />
      <output aria-label="chosen">{value}</output>
    </>
  );
}

describe("filterOptions", () => {
  it("needs every typed word in the label, in any order, ignoring case", () => {
    expect(filterOptions(options, "DESK remote").map((o) => o.value)).toEqual(["remote-access/remote-desktop-and-support"]);
    expect(filterOptions(options, "torrent").map((o) => o.value)).toEqual(["p2p/torrent-clients"]);
    expect(filterOptions(options, "zzz")).toEqual([]);
  });

  it("keeps the empty choice only while nothing is typed", () => {
    expect(filterOptions(options, "")).toHaveLength(4);
    expect(filterOptions(options, "all").map((o) => o.value)).not.toContain("");
  });
});

describe("SearchSelect", () => {
  it("opens with a search box, filters while typing and chooses with a click", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent("All categories");
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.type(screen.getByRole("searchbox", { name: "Search categories" }), "torr");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.click(screen.getByRole("option", { name: "P2P / Torrent clients" }));
    expect(screen.getByLabelText("chosen")).toHaveTextContent("p2p/torrent-clients");
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent("P2P / Torrent clients");
  });

  it("works with the keyboard: arrows, Enter and Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.type(screen.getByRole("searchbox"), "remote{ArrowDown}{Enter}");
    expect(screen.getByLabelText("chosen")).toHaveTextContent("remote-access/remote-desktop-and-support");
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.type(screen.getByRole("searchbox"), "qqq");
    expect(screen.getByText(/No match for/)).toBeInTheDocument();
  });
});
