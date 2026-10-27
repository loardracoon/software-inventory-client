// Turns the local pg_cron collector tick on or off by writing (or removing) the Vault secrets that
// public.invoke_collector() reads. Once on, the tick runs every 5 minutes against the configured
// Sophos Central tenant.
// Usage: npm run collector:configure            (on: COLLECTOR_SECRET from supabase/functions/.env)
//        npm run collector:configure -- --off   (off)
//        npm run collector:configure -- --url <collector URL as seen from the database container>
// Remote projects: run the SQL in supabase/migrations/*_collector_cron.sql's header instead.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DB_CONTAINER = "supabase_db_endpoint-inventory";
const args = process.argv.slice(2);
const off = args.includes("--off");
const urlArg = args.indexOf("--url");
const url = urlArg >= 0 ? args[urlArg + 1] : "http://kong:8000/functions/v1/collector";

let sql = "delete from vault.secrets where name in ('collector_url', 'collector_secret');\n";
if (!off) {
  const env = readFileSync("supabase/functions/.env", "utf8");
  const secret = /^COLLECTOR_SECRET=(.*)$/m.exec(env)?.[1]?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{16,}$/.test(secret)) {
    console.error("Set COLLECTOR_SECRET (16+ letters, digits, _ or -) in supabase/functions/.env first, then restart the stack.");
    process.exit(1);
  }
  if (!/^https?:\/\/[^\s$']+$/.test(url)) {
    console.error(`Invalid collector URL: ${url}`);
    process.exit(1);
  }
  sql += `select vault.create_secret($v$${url}$v$, 'collector_url', 'Collector Edge Function URL for pg_cron');\n`;
  sql += `select vault.create_secret($v$${secret}$v$, 'collector_secret', 'Shared secret pg_cron sends in x-collector-secret');\n`;
}

const result = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t"], {
  input: sql,
  encoding: "utf8",
});
if (result.status !== 0) {
  console.error(result.stderr || "psql failed");
  process.exit(result.status ?? 1);
}
console.log(off ? "Collector tick turned off (Vault secrets removed)." : `Collector tick turned on: pg_cron calls ${url} every 5 minutes.`);
