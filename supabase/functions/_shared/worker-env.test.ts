import { describe, expect, it } from "vitest";
import { workerEnvs } from "./worker-env";

const env = { JWT_SECRET: "router-secret", NO_VERIFY_JWT: "collector,mcp", SUPABASE_URL: "http://kong:8000", MCP_JWT_SECRET: "planted" };

describe("workerEnvs", () => {
  it("never gives the JWT secret to an ordinary worker", () => {
    const vars = Object.fromEntries(workerEnvs(env).forWorker("collector"));
    expect(vars).toEqual({ SUPABASE_URL: "http://kong:8000" });
  });

  it("gives only the mcp worker the secret, as MCP_JWT_SECRET", () => {
    const vars = Object.fromEntries(workerEnvs(env).forWorker("mcp"));
    expect(vars).toEqual({ SUPABASE_URL: "http://kong:8000", MCP_JWT_SECRET: "router-secret" });
    expect(vars.JWT_SECRET).toBeUndefined();
  });

  it("does not pass a MCP_JWT_SECRET set on the container to other workers", () => {
    for (const name of ["alerts", "hub-sync", "audit-report", "mcp-probe"]) {
      expect(Object.fromEntries(workerEnvs(env).forWorker(name)).MCP_JWT_SECRET).toBeUndefined();
    }
  });

  it("gives mcp no secret when the router has none", () => {
    expect(Object.fromEntries(workerEnvs({ SUPABASE_URL: "x" }).forWorker("mcp"))).toEqual({ SUPABASE_URL: "x" });
  });
});
