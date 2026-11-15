import { describe, expect, it } from "vitest";
import { dueLabel, findingsToCsv, type FindingRow } from "./api";

const NOW = Date.parse("2026-11-15T12:00:00Z");

describe("remediation findings", () => {
  it("labels days left, due today, overdue and resolved", () => {
    const f = (status: string, due_at: string, days_open = 4) => ({ status, due_at, days_open }) as FindingRow;
    expect(dueLabel(f("open", "2026-11-20T12:00:00Z"), NOW)).toBe("5 days left");
    expect(dueLabel(f("open", "2026-11-16T12:00:00Z"), NOW)).toBe("1 day left");
    expect(dueLabel(f("overdue", "2026-11-15T12:00:00Z"), NOW)).toBe("Due today");
    expect(dueLabel(f("overdue", "2026-11-12T12:00:00Z"), NOW)).toBe("3 days overdue");
    expect(dueLabel(f("resolved_late", "2026-11-01T00:00:00Z", 1), NOW)).toBe("Resolved after 1 day");
  });

  it("exports CSV with quoting and formula guard", () => {
    const row = { vuln_id: "CVE-1", canonical_name: "=Evil, Inc", version: "1", severity: "HIGH", kev: true, status: "overdue", first_seen_at: "a", due_at: "b", resolved_at: null, days_open: 3, computers: 2 } as FindingRow;
    const [head, line] = findingsToCsv([row]).split("\r\n");
    expect(head).toBe("vuln_id,software,version,severity,kev,status,first_seen_at,due_at,resolved_at,days_open,computers");
    expect(line).toBe("CVE-1,\"'=Evil, Inc\",1,HIGH,true,overdue,a,b,,3,2");
  });
});
