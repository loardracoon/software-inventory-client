#!/usr/bin/env bash
# Keeps this host on the build CI deploys on main (docs/operations.md › Deploy on one host). When this folder is a git
# checkout, it first pulls main (so changes to docker-compose.yml, the Caddyfile and rate-limits.env arrive
# too); then it reads the image tag CI wrote into deploy/k3s/app/stack.yaml and, when it changed, pulls the
# images, applies new migrations and recreates what changed. Run by endpoint-inventory-update.timer
# (install.sh --auto-update) or by hand. ./update.sh --tag SHA pins a build.
set -euo pipefail
cd "$(dirname "$0")"
REPO=loardracoon/software-inventory-client
tag=""
[ "${1:-}" = "--tag" ] && tag=${2:-}

if [ -z "$tag" ]; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git pull -q --ff-only || echo "git pull failed (local changes?); using the files as they are"
    stack=$(git rev-parse --show-toplevel)/deploy/k3s/app/stack.yaml
    tag=$(sed -n "s#.*image: ghcr.io/$REPO-web:\([0-9a-f]\{40\}\).*#\1#p" "$stack" | head -n 1)
  else
    tag=$(curl -fsS "https://raw.githubusercontent.com/$REPO/main/deploy/k3s/app/stack.yaml" \
      | sed -n "s#.*image: ghcr.io/$REPO-web:\([0-9a-f]\{40\}\).*#\1#p" | head -n 1)
  fi
fi
[ -n "$tag" ] || { echo "No image tag found"; exit 1; }
current=$(sed -n 's/^APP_TAG=//p' .env)

if [ "$tag" != "$current" ]; then
  echo "Updating from ${current:-nothing} to $tag"
  APP_TAG=$tag docker compose pull -q functions kong migrate
  APP_TAG=$tag docker compose run --rm migrate
  sed -i.bak "s/^APP_TAG=.*/APP_TAG=$tag/" .env && rm -f .env.bak
fi
# Recreates only the services whose image or settings changed (a no-op when nothing did).
docker compose up -d --wait
docker image prune -f >/dev/null
echo "Endpoint Inventory is on $tag"
