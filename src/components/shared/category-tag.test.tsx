import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryTag, formatCategoryOrigin } from "./category-tag";

describe("CategoryTag", () => {
  it("shows level 1 above level 2 with a Review badge", () => {
    render(
      <CategoryTag
        category={{ level1: "Remote access", level2: "Remote desktop", attention: "review" }}
        origin={{ source: "hub", method: "reviewed" }}
      />,
    );
    expect(screen.getByText("Remote access")).toBeInTheDocument();
    expect(screen.getByText("Remote desktop")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Hub · reviewed")).toBeInTheDocument();
  });

  it("shows a Not allowed badge", () => {
    render(<CategoryTag category={{ level1: "Proxy and tunnel", level2: "Tunnel", attention: "not_allowed" }} />);
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
  });

  it("shows no badge for info", () => {
    render(<CategoryTag category={{ level1: "Productivity", level2: "Office suite", attention: "info" }} />);
    expect(screen.queryByText("Review")).toBeNull();
    expect(screen.queryByText("Not allowed")).toBeNull();
  });

  it("shows unclassified titles", () => {
    render(<CategoryTag category={null} origin={{ source: "unclassified" }} />);
    expect(screen.getByText("Unclassified (sent to hub)")).toBeInTheDocument();
  });
});

describe("formatCategoryOrigin", () => {
  it("formats every origin", () => {
    expect(formatCategoryOrigin({ source: "hub", method: "jev", confidence: 0.97 })).toBe("Hub · Jev 0.97");
    expect(formatCategoryOrigin({ source: "hub", method: "reviewed" })).toBe("Hub · reviewed");
    expect(formatCategoryOrigin({ source: "local_override" })).toBe("Local override");
    expect(formatCategoryOrigin({ source: "unclassified" })).toBe("Unclassified");
  });
});
