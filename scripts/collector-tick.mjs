// Runs one collector tick now against the local stack (same call pg_cron makes).
// Usage: npm run collector:tick
import { readFileSync } from "node:fs";

const env = readFileSync("supabase/functions/.env", "utf8");
const secret = /^COLLECTOR_SECRET=(.*)$/m.exec(env)?.[1]?.trim();
if (!secret) {
  console.error("Set COLLECTOR_SECRET in supabase/functions/.env first, then restart the stack.");
  process.exit(1);
}
const response = await fetch("http://127.0.0.1:54321/functions/v1/collector", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-collector-secret": secret },
  body: "{}",
});
console.log(`HTTP ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
