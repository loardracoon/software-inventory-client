#!/bin/sh
# Writes /env.js from SUPABASE_URL and SUPABASE_ANON_KEY, so one image serves any host. The nginx image runs
# this at start from /docker-entrypoint.d. Empty values leave the build-time ones in effect.
# SUPABASE_URL=origin means "the host the page was opened on", so one deployment can answer on several names.
set -eu
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
if [ "${SUPABASE_URL:-}" = "origin" ]; then
  url="window.location.origin"
else
  url="\"$(esc "${SUPABASE_URL:-}")\""
fi
printf 'window.__ENV__ = { SUPABASE_URL: %s, SUPABASE_ANON_KEY: "%s" };\n' "$url" "$(esc "${SUPABASE_ANON_KEY:-}")" > /usr/share/nginx/html/env.js
