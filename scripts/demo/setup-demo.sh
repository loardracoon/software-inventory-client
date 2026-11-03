#!/usr/bin/env bash
# Builds a demo of Endpoint Inventory for walkthrough videos and screenshots, on an ISOLATED local stack and
# with fictional data only (scripts/demo/README.md). It resets that stack's database: never point it at the
# main local stack or at a real deployment.
#
#   scripts/demo/setup-demo.sh <isolated workdir>
#
# <isolated workdir> holds a copy of supabase/ whose config.toml has its own project_id, ports 553xx and
# site_url = "http://localhost:5174" (docs/operations.md › Tests). The script copies the current migrations and
# functions into it, resets it, starts the demo mocks, runs two weeks of collection through the real
# collector, classifies the titles through the mock Hub, publishes a policy, adds a read-only viewer and
# serves the app on http://localhost:5174. Then scripts/demo/viewer-link.sh prints a sign-in link.
set -euo pipefail
W=${1:?usage: setup-demo.sh <isolated workdir>}
APP=$(cd "$(dirname "$0")/../.." && pwd)
CFG="$W/supabase/config.toml"
[ -f "$CFG" ] || { echo "No $CFG"; exit 2; }
project=$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$CFG")
main=$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$APP/supabase/config.toml")
api_port=$(awk '/^\[api\]/{f=1} f&&/^port =/{print $3; exit}' "$CFG")
if [ "$project" = "$main" ] || [ "$api_port" = "54321" ]; then
  echo "Refused: $W is not an isolated stack (project_id $project, API port $api_port)"; exit 2
fi
grep -q 'site_url = "http://localhost:5174"' "$CFG" || { echo "Set site_url = \"http://localhost:5174\" in $CFG"; exit 2; }

SB() { npx --prefix "$APP" supabase --workdir "$W" "$@"; }
API=http://127.0.0.1:$api_port
# Mailpit: [local_smtp] in current Supabase CLI versions, [inbucket] in older ones.
MP=http://127.0.0.1:$(awk '/^\[(local_smtp|inbucket)\]/{f=1} f&&/^port =/{print $3; exit}' "$CFG")
DBC=supabase_db_$project
DB() { docker exec -i "$DBC" psql -U postgres -tA -v ON_ERROR_STOP=1 "$@"; }
SECRET=demo-collector-secret-0123456789abcdef
LOG="$W/demo-logs"; mkdir -p "$LOG"

echo "== 1. Stack: current migrations and functions, reset"
rm -rf "$W/supabase/migrations" "$W/supabase/functions"
cp -r "$APP/supabase/migrations" "$APP/supabase/functions" "$W/supabase/"
printf 'SOPHOS_ID_URL=http://host.docker.internal:54999\nSOPHOS_GLOBAL_URL=http://host.docker.internal:54999\nSOPHOS_LES_URL=http://host.docker.internal:54999/graphql\nCOLLECTOR_SECRET=%s\n' "$SECRET" > "$W/demo-functions.env"
SB start -x studio,imgproxy,vector,logflare >/dev/null
SB db reset >/dev/null
ANON=$(SB status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')

echo "== 2. Mocks and functions"
for p in 54998 54999 5174; do
  if curl -s -o /dev/null --max-time 2 "http://localhost:$p/"; then echo "Port $p is in use: stop what runs there first"; exit 2; fi
done
node "$APP/scripts/demo/mock-sophos-demo.mjs" 54999 > "$LOG/sophos.log" 2>&1 &
node "$APP/scripts/mock-dictionary-hub.mjs" 54998 > "$LOG/hub.log" 2>&1 &
SB functions serve --env-file "$W/demo-functions.env" > "$LOG/functions.log" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' -X POST "$API/functions/v1/collector" | grep -qE '^(401|403)$' && break; sleep 2; done

tick() { curl -s -X POST "$API/functions/v1/collector" -H "Content-Type: application/json" -H "x-collector-secret: $SECRET" -d '{}' >/dev/null; sleep 2; }
# Ticks until the cycles opened by this step have no task waiting (the limits of 4 active runs and 10 runs
# per minute make a week take minutes). A tick that finds the lease taken (for example the first tick, slowed by
# the cold start of the functions, still holds it) does not count.
collect() {
  local since left opened out
  since=$(DB -c "select now()")
  for i in $(seq 1 300); do
    out=$(curl -s --max-time 150 -X POST "$API/functions/v1/collector" -H "Content-Type: application/json" -H "x-collector-secret: $SECRET" -d '{}' || true)
    case "$out" in *"Another collector tick"*|"") sleep 5; continue ;; esac
    sleep 2
    opened=$(DB -c "select count(*) from public.scan_cycles where status = 'open' and opened_at >= '$since'")
    left=$(DB -c "select count(*) from public.scan_tasks t join public.scan_cycles c on c.id = t.cycle_id and c.status = 'open' where t.status in ('pending', 'dispatched')")
    [ "$opened" -gt 0 ] && [ "$left" = "0" ] && return 0
  done
  echo "Collection still has $left tasks waiting"
}
signin() { # email -> access token (magic link from Mailpit)
  curl -s -o /dev/null -X POST "$API/auth/v1/otp" -H "apikey: $ANON" -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"create_user\":true}"
  sleep 2
  local id link
  id=$(curl -s "$MP/api/v1/messages" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).messages.find(m=>m.To[0].Address==='$1').ID))")
  link=$(curl -s "$MP/api/v1/message/$id" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).Text.match(/http:\/\/\S+verify\S+/)[0]))")
  curl -s -o /dev/null -w '%{redirect_url}' "$link" | sed -n 's/.*access_token=\([^&]*\).*/\1/p'
}
rpc() { curl -s -X POST "$API/rest/v1/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }
fn() { curl -s -X POST "$API/functions/v1/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "${3:-{\}}" >/dev/null; }

echo "== 3. Admin, Sophos credential, Hub connection"
ADMIN=$(signin admin.demo@example.com)   # the first account of an empty install is its admin
DB -c "insert into public.sophos_connection (id, client_id, secret_id) values (1, '11111111-2222-3333-4444-555566667777', vault.create_secret('mock-secret-value-0123456789abcdef', 'sophos_client_secret', 'demo'))" >/dev/null
rpc "$ADMIN" set_hub_connection '{"p_url":"http://host.docker.internal:54998","p_key":"mock-hub-client-key-0123456789"}' >/dev/null

echo "== 4. Week 1 collection (a few minutes)"
collect
# Move week 1 back seven days, so the history and the weekly charts show two weeks.
DB <<'SQL' >/dev/null
do $$
declare r record; t timestamptz := now();
begin
  for r in select c.table_name, c.column_name from information_schema.columns c join information_schema.tables tb
             on tb.table_schema = c.table_schema and tb.table_name = c.table_name
           where c.table_schema = 'public' and tb.table_type = 'BASE TABLE' and c.data_type = 'timestamp with time zone'
  loop
    execute format('update public.%I set %I = %I - interval ''7 days'' where %I < $1', r.table_name, r.column_name, r.column_name, r.column_name) using t;
  end loop;
end $$;
SQL

echo "== 5. Hub: share titles, classify them, add CVEs"
fn "$ADMIN" hub-sync
DB -c "select coalesce(json_agg(json_build_object('name', t.canonical_name, 'product_key', p.product_key)), '[]') from public.software_titles t join public.title_products p on p.title_id = t.id" > "$LOG/product-keys.json"
node "$APP/scripts/demo/load-hub.mjs" http://localhost:54998 "$LOG/product-keys.json"
fn "$ADMIN" hub-sync

echo "== 6. Week 2: upgrades, new and removed software"
curl -s -X POST http://localhost:54999/__upgrade >/dev/null
collect
fn "$ADMIN" hub-sync
DB -c "select coalesce(json_agg(json_build_object('name', t.canonical_name, 'product_key', p.product_key)), '[]') from public.software_titles t join public.title_products p on p.title_id = t.id" > "$LOG/product-keys.json"
node "$APP/scripts/demo/load-hub.mjs" http://localhost:54998 "$LOG/product-keys.json"
fn "$ADMIN" hub-sync

echo "== 7. Application policy for each tenant"
for T in $(DB -c "select id from public.tenants order by name"); do
  rule() { local r; r=$(rpc "$ADMIN" policy_save_rule "{\"p_tenant_id\":\"$T\",\"p_rule\":$1}"); case "$r" in *\"code\"*) echo "Rule refused: $r"; exit 1 ;; esac; }
  rule '{"name":"Sophos and Windows components","class":"core_system","match":"any","kinds":["program","extension","ide_extension","package"],"enabled":true,"conditions":[{"field":"subcategory","operator":"in","values":["sophos-applications/sophos-agents-and-tools","system-applications/os-components-and-runtimes"]}]}'
  rule '{"name":"Known exploited vulnerability","class":"unsanctioned_app","match":"all","kinds":["program"],"enabled":true,"conditions":[{"field":"kev","operator":"equals","value":"true"}]}'
  rule '{"name":"Torrent and anonymizers","class":"unsanctioned_app","match":"any","kinds":["program","extension","ide_extension","package"],"enabled":true,"conditions":[{"field":"subcategory","operator":"in","values":["p2p/torrent-clients","proxy-and-tunnel/anonymizers","proxy-and-tunnel/consumer-vpn-and-proxy-services"]}]}'
  rule '{"name":"Remote access tools","class":"tolerated_app","match":"all","kinds":["program","extension","ide_extension","package"],"enabled":true,"owner":"IT Operations","business_purpose":"Remote support for staff and vendors","mitigating_controls":"MFA on every remote access account; sessions are logged","risk_accepted_by":"CISO","review_by":"2027-03-31","conditions":[{"field":"category","operator":"equals","value":"remote-access"}]}'
  rule '{"name":"Approved business software","class":"sanctioned_app","match":"any","kinds":["program","extension","ide_extension","package"],"enabled":true,"conditions":[{"field":"category","operator":"in","values":["general-business","general-internet","conferencing","instant-messenger","developer-tools","security-and-identity","storage-and-backup"]}]}'
  rpc "$ADMIN" policy_set_default_class "{\"p_tenant_id\":\"$T\",\"p_class\":\"tolerated_app\"}" >/dev/null
  published=$(rpc "$ADMIN" policy_publish "{\"p_tenant_id\":\"$T\"}")
  case "$published" in *\"code\"*) echo "Policy not published: $published"; exit 1 ;; esac
  fn "$ADMIN" policy-evaluate "{\"tenant_id\":\"$T\"}"
done
tick; tick

echo "== 8. Read-only viewer"
DB -c "insert into public.access_rules (kind, value, role) values ('email', 'demo.viewer@example.com', 'viewer') on conflict do nothing" >/dev/null
signin demo.viewer@example.com >/dev/null

echo "== 9. App on http://localhost:5174"
(cd "$APP" && VITE_SUPABASE_URL=$API VITE_SUPABASE_ANON_KEY=$ANON nohup npx vite --port 5174 --strictPort > "$LOG/vite.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:5174 && break; sleep 2; done

DB -c "select 'computers ' || (select count(*) from computers) || ', installations ' || (select count(*) from installations where valid_to is null) || ', changes ' || (select count(*) from change_events) || ', titles ' || (select count(*) from software_titles) || ', classified ' || (select count(*) from title_classification where category_slug is not null) || ', CVE matches ' || (select count(*) from title_version_vulns)"
echo "Ready. Sign in as the viewer: scripts/demo/viewer-link.sh $W"
