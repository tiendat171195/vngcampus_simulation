#!/usr/bin/env bash
# Deploys image TAG to HOST over SSH (docs/runbook.md): copy the compose files, pull, migrate,
# restart, then check health through the public address. Used by .github/workflows/deploy.yml
# and by hand: HOST=… SSH_USER=… TAG=… SSH_KEY="$(cat key)" KNOWN_HOSTS="$(ssh-keyscan host)" infra/deploy.sh
set -euo pipefail
: "${HOST:?}" "${TAG:?}" "${SSH_KEY:?}" "${KNOWN_HOSTS:?}"
SSH_USER="${SSH_USER:-deploy}"
DIR="${DEPLOY_DIR:-/srv/campus}"

key="$(mktemp)"
known="$(mktemp)"
trap 'rm -f "$key" "$known"' EXIT
printf '%s\n' "$SSH_KEY" > "$key"
printf '%s\n' "$KNOWN_HOSTS" > "$known"
chmod 600 "$key"
ssh_opts=(-i "$key" -o UserKnownHostsFile="$known" -o StrictHostKeyChecking=yes)

here="$(cd "$(dirname "$0")" && pwd)"
scp "${ssh_opts[@]}" "$here/compose.prod.yaml" "$here/backup.sh" "$SSH_USER@$HOST:$DIR/"

# prod.env stays on the server; only IMAGE_TAG changes. The old tag is kept for a rollback.
ssh "${ssh_opts[@]}" "$SSH_USER@$HOST" DIR="$DIR" TAG="$TAG" bash -s <<'REMOTE'
set -euo pipefail
cd "$DIR"
previous="$(grep '^IMAGE_TAG=' prod.env | cut -d= -f2)"
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" prod.env
echo "$previous" > previous-tag
compose() { docker compose --env-file prod.env -f compose.prod.yaml "$@"; }
compose pull --quiet
compose run --rm migrate
compose up -d --remove-orphans
compose ps
REMOTE

# Health through the public address, as people reach it.
for path in /api/health /rt/health; do
  for attempt in $(seq 1 30); do
    if curl -fsS "https://$HOST$path" > /dev/null; then echo "ok $path"; break; fi
    if [ "$attempt" = 30 ]; then echo "health check failed: $path" >&2; exit 1; fi
    sleep 5
  done
done
