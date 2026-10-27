import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { asScanStatus, StatusBadge, type ScanStatus } from "./status-badge";

const CASES: [ScanStatus, string][] = [
  ["collected", "Collected"],
  ["dispatched", "Dispatched"],
  ["retry_scheduled", "Retry scheduled"],
  ["missed", "Missed"],
  ["error", "Error"],
  ["pending", "Waiting"],
  ["skipped", "Skipped"],
  ["not_scheduled", "Not scheduled"],
];

describe("StatusBadge", () => {
  it.each(CASES)("shows a word and an icon for %s", (status, word) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(word)).toBeInTheDocument();
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the icon when the word is overridden", () => {
    const { container } = render(<StatusBadge status="error" label="Query error" />);
    expect(screen.getByText("Query error")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("maps task statuses", () => {
    expect(asScanStatus("no_response")).toBe("retry_scheduled");
    expect(asScanStatus("collected")).toBe("collected");
    expect(asScanStatus(null)).toBe("not_scheduled");
  });
});
