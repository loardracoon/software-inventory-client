// Type-checks every Edge Function with Deno in Docker (Deno does not need to be installed).
// Usage: npm run functions:check
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const DENO_IMAGE = "denoland/deno:2.5.6";
const functionsDir = resolve("supabase/functions");
const entries = readdirSync(functionsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(functionsDir, d.name, "index.ts")))
  .map((d) => `${d.name}/index.ts`);

if (entries.length === 0) {
  console.log("No Edge Functions to check.");
  process.exit(0);
}

const result = spawnSync(
  "docker",
  ["run", "--rm", "-v", `${functionsDir}:/fns`, "-w", "/fns", DENO_IMAGE, "deno", "check", "--quiet", ...entries],
  { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
);
process.exit(result.status ?? 1);
