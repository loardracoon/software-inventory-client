import { describe, expect, it } from "vitest";
import { claudeCodeCommand, mcpServerUrl, tokenState } from "./api";

describe("AI assistants api", () => {
  it("builds the server URL from the Supabase URL", () => {
    expect(mcpServerUrl("https://inventory.example.com/")).toBe("https://inventory.example.com/functions/v1/mcp");
    expect(mcpServerUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/functions/v1/mcp");
  });

  it("tells active, expired and revoked tokens apart", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(tokenState({ revoked_at: null as unknown as string, expires_at: "2026-12-01T00:00:00Z" }, now)).toBe("active");
    expect(tokenState({ revoked_at: null as unknown as string, expires_at: "2026-11-16T12:00:00Z" }, now)).toBe("expired");
    expect(tokenState({ revoked_at: "2026-11-10T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" }, now)).toBe("revoked");
  });

  it("writes the Claude Code command with the token as a header", () => {
    expect(claudeCodeCommand("https://h/functions/v1/mcp", "eimcp_x")).toBe(
      'claude mcp add --transport http endpoint-inventory https://h/functions/v1/mcp --header "Authorization: Bearer eimcp_x"',
    );
  });
});
