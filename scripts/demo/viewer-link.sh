#!/usr/bin/env bash
# Prints a fresh one-time sign-in link for the demo viewer (demo.viewer@example.com, read only) of the demo
# stack built by setup-demo.sh. Open it in the browser or in Playwright (page.goto) to be signed in.
#   scripts/demo/viewer-link.sh <isolated workdir>
set -euo pipefail
W=${1:?usage: viewer-link.sh <isolated workdir>}
CFG="$W/supabase/config.toml"
API=http://127.0.0.1:$(awk '/^\[api\]/{f=1} f&&/^port =/{print $3; exit}' "$CFG")
MP=http://127.0.0.1:$(awk '/^\[(local_smtp|inbucket)\]/{f=1} f&&/^port =/{print $3; exit}' "$CFG")
EMAIL=demo.viewer@example.com
ANON=$(npx --prefix "$(dirname "$0")/../.." supabase --workdir "$W" status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
since=$(date +%s)
curl -s -o /dev/null -X POST "$API/auth/v1/otp" -H "apikey: $ANON" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"create_user\":false}"
for i in $(seq 1 20); do
  link=$(curl -s "$MP/api/v1/messages" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',async()=>{
      const m=JSON.parse(s).messages.find(m=>m.To[0].Address==='$EMAIL'&&Date.parse(m.Created)/1000>=$since-2);
      if(!m)return;
      const t=await (await fetch('$MP/api/v1/message/'+m.ID)).json();
      console.log((t.Text.match(/http:\/\/\S+verify\S+/)||[''])[0]);
    })")
  [ -n "$link" ] && { echo "$link"; exit 0; }
  sleep 1
done
echo "No sign-in email for $EMAIL in Mailpit ($MP)" >&2; exit 1
