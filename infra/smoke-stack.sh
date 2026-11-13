#!/usr/bin/env bash
# Starts the production stack (compose.prod.yaml) from images already built, then checks it end to
# end through Caddy: both static apps, the API with its migrations, a guest sign-in, a realtime
# seat reserved with the API's token, the WebSocket upgrade, the private metrics and the first
# backup. CI runs it after building the images; locally:
#   docker build --target api -t campus/api:local .   (same for realtime and web), then
#   IMAGE_REPO=campus IMAGE_TAG=local infra/smoke-stack.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
port="${HTTP_PORT:-8080}"
work="$(mktemp -d)"
cp "$here/compose.prod.yaml" "$here/backup.sh" "$work/"
password="$(openssl rand -hex 16)"
{
  echo "IMAGE_REPO=${IMAGE_REPO:-campus}"
  echo "IMAGE_TAG=${IMAGE_TAG:-local}"
  echo "SITE_ADDRESS=:80"
  echo "HTTP_PORT=$port"
  echo "HTTPS_PORT=${HTTPS_PORT:-8443}"
  echo "PUBLIC_URL=http://localhost:$port"
  echo "POSTGRES_PASSWORD=$password"
  echo "DATABASE_URL=postgres://campus:$password@postgres:5432/campus"
  node "$here/../scripts/generate-jwt-key.mjs"
  echo "GUEST_MODE=full"
  echo "AUTH_JWKS_URL=http://api:3001/api/v1/auth/jwks"
  echo "ANALYTICS_SALT=$(openssl rand -hex 24)"
} > "$work/prod.env"

compose() { docker compose -p campus-smoke --env-file "$work/prod.env" -f "$work/compose.prod.yaml" "$@"; }
cleanup() {
  status=$?
  [ "$status" -eq 0 ] || compose logs --tail 60 || true
  # The dumps belong to the container's user; remove them from inside.
  compose exec -T backup sh -c 'rm -rf /backups/*' > /dev/null 2>&1 || true
  compose down -v --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$work" 2> /dev/null || true
  exit "$status"
}
trap cleanup EXIT

ok() { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log($1)})"; }

compose up -d --quiet-pull
base="http://localhost:$port"
for path in /api/health /rt/health; do
  for attempt in $(seq 1 60); do
    curl -fsS "$base$path" > /dev/null 2>&1 && break
    [ "$attempt" = 60 ] && fail "no answer from $path"
    sleep 2
  done
done

[ "$(curl -fsS "$base/api/health" | json v.status)" = ok ] && ok "api health through Caddy"
[ "$(curl -fsS "$base/rt/health" | json v.status)" = ok ] && ok "realtime health through Caddy"

home="$(curl -fsS "$base/")"
grep -q '<div id="root">' <<< "$home" || fail "game page"
ok "game page"
grep -q 'VNG Campus Online — Admin' <<< "$(curl -fsS "$base/admin/missions")" || fail "admin page"
ok "admin page, deep link falls back to the app"
asset="$(grep -oE '/assets/[^"]+\.js' <<< "$home" | head -1)"
curl -fsSI "$base$asset" | grep -qi 'cache-control: public, max-age=31536000, immutable' || fail "asset caching"
curl -fsSI "$base/" | grep -qi 'cache-control: no-cache' || fail "page caching"
curl -fsSI "$base/" | grep -qi 'x-content-type-options: nosniff' || fail "security headers"
ok "caching and security headers"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/rt/metrics")" = 404 ] || fail "metrics are public"
ok "metrics stay private"

token="$(curl -fsS -X POST -H 'content-type: application/json' \
  -d '{"name":"Kiểm Tra","consent":1}' "$base/api/v1/auth/guest" | json v.accessToken)"
[ -n "$token" ] || fail "guest sign-in"
ok "guest sign-in (database migrated)"
seat="$(curl -fsS -X POST -H 'content-type: application/json' \
  -d "{\"token\":\"$token\",\"open\":true}" "$base/rt/matchmake/joinOrCreate/campus")"
url="$(json "\`/rt/\${v.processId??v.room.processId}/\${v.roomId??v.room.roomId}?sessionId=\${v.sessionId}\`" <<< "$seat")"
ok "realtime seat with the API's token"
code="$(curl -s --http1.1 -o /dev/null -w '%{http_code}' --max-time 3 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$base$url" || true)"
[ "$code" = 101 ] || fail "websocket upgrade through Caddy (got $code)"
ok "websocket upgrade through Caddy"

for attempt in $(seq 1 30); do
  compose exec -T backup test -f /backups/last-success && break
  [ "$attempt" = 30 ] && fail "first backup"
  sleep 2
done
ok "first backup written"

# Restore drill, with the runbook's commands: dump, restore over the live database, and the
# account made above is still there.
compose exec -T backup sh -c 'pg_dump --format=custom --no-owner' > "$work/drill.dump"
compose exec -T postgres pg_restore -U campus -d campus --clean --if-exists < "$work/drill.dump"
[ "$(curl -fsS -H "authorization: Bearer $token" "$base/api/v1/me" | json v.displayName)" = 'Kiểm Tra' ] \
  || fail "restore drill"
ok "dump and restore keep the data"
echo "stack smoke test passed"
