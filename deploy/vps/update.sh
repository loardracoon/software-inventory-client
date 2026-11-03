#!/bin/sh
# Keeps the VPS on the same client build CI deploys: reads the image tag that CI wrote into
# deploy/k3s/app/stack.yaml on main and, when it changed, pulls the images, applies new migrations and
# recreates the functions and the gateway. Run by endpoint-inventory-update.timer every 5 minutes.
set -eu
cd /opt/endpoint-inventory

tag=$(curl -fsS "https://raw.githubusercontent.com/loardracoon/software-inventory-client/main/deploy/k3s/app/stack.yaml" \
  | sed -n 's#.*image: ghcr.io/loardracoon/software-inventory-client-web:\([0-9a-f]\{40\}\).*#\1#p' | head -n 1)
[ -n "$tag" ] || { echo "No image tag found"; exit 1; }
current=$(sed -n 's/^APP_TAG=//p' .env)
[ "$tag" = "$current" ] && exit 0

echo "Updating Endpoint Inventory from $current to $tag"
APP_TAG=$tag docker compose pull -q functions kong migrate
APP_TAG=$tag docker compose run --rm migrate
sed -i "s/^APP_TAG=.*/APP_TAG=$tag/" .env
docker compose up -d functions kong
docker image prune -f > /dev/null
echo "Endpoint Inventory is on $tag"
