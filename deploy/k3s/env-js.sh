#!/bin/sh
# Writes /env.js from SUPABASE_URL and SUPABASE_ANON_KEY, so one image serves any host. The nginx image runs
# this at start from /docker-entrypoint.d. Empty values leave the build-time ones in effect.
set -eu
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
printf 'window.__ENV__ = { SUPABASE_URL: "%s", SUPABASE_ANON_KEY: "%s" };\n' \
  "$(esc "${SUPABASE_URL:-}")" "$(esc "${SUPABASE_ANON_KEY:-}")" > /usr/share/nginx/html/env.js
