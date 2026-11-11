#!/bin/sh
# Tests the copies of the database end to end (ADR 0016) with the real deploy/docker-compose.yml, the
# real app image (built here) and a local S3 (S3Mock) in place of R2. Takes a few minutes; needs docker.
#   sh scripts/test-backup.sh
# 1. boards are made, 2. the volume is destroyed and the database comes back by itself,
# 3. restore.sh goes back to a chosen moment, 4. copying goes on after that and survives a second loss.
# shellcheck disable=SC2015,SC2016
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
NET=inkroombk
S3=inkroombk-s3
PORT=18081
export COMPOSE_PROJECT_NAME=inkroombk
export INKROOM_TAG=backup-test

fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

cleanup() {
	if [ -n "${KEEP:-}" ]; then echo "kept for inspection: $WORK (network $NET, container $S3); remove them by hand"; return; fi
	(cd "$WORK" && docker compose --profile tools down -v >/dev/null 2>&1) || true
	docker rm -f "$S3" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

echo "building the app image..."
docker build -q -t "ghcr.io/maciekgangus/inkroom:$INKROOM_TAG" "$ROOT" >/dev/null

docker network create "$NET" >/dev/null
# A local S3 (Adobe S3Mock) with the bucket already made; it takes any key.
docker run -d --name "$S3" --network "$NET" -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=inkroom-test adobe/s3mock >/dev/null
sleep 12 # Java: it needs a moment

# The deploy folder as it would be on the server, with a test .env and a few changes: the network of
# S3Mock, a port on this machine, no tunnel.
cp "$ROOT"/deploy/docker-compose.yml "$ROOT"/deploy/litestream.yml "$WORK"/
chmod 755 "$WORK" && chmod 644 "$WORK"/litestream.yml # the containers read it as another user
cat >"$WORK/.env" <<'EOF'
TUNNEL_TOKEN=unused
R2_BUCKET=inkroom-test
R2_ENDPOINT=http://inkroombk-s3:9090
R2_ACCESS_KEY_ID=test-key
R2_SECRET_ACCESS_KEY=test-secret
SEED_USER_EMAIL=teacher@example.test
SEED_USER_PASSWORD=teacher-pass-1234
EOF
cat >"$WORK/test.yml" <<EOF
networks:
  default:
    name: $NET
    external: true
services:
  app:
    ports: !override
      - "127.0.0.1:$PORT:8080"
EOF
cp "$ROOT"/deploy/restore.sh "$ROOT"/deploy/docker-compose.selinux.yml "$WORK"/
cd "$WORK"
# restore.sh runs plain `docker compose`, so what compose reads is set in COMPOSE_FILE, as on a server.
export COMPOSE_FILE=docker-compose.yml:test.yml
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = Enforcing ]; then
	COMPOSE_FILE=$COMPOSE_FILE:docker-compose.selinux.yml # this machine has SELinux, see that file
fi
dc() { docker compose "$@"; }

up() {
	dc up -d app litestream >/dev/null
	for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null && return 0; sleep 1; done
	echo "--- it did not come up; what the containers say:" >&2
	dc ps -a >&2
	dc logs --tail 25 >&2
	return 1
}
login() { curl -s -c "$WORK/jar" -H 'Content-Type: application/json' -d '{"login":"teacher@example.test","password":"teacher-pass-1234"}' "http://127.0.0.1:$PORT/api/login" >/dev/null; }
make_board() { curl -s -b "$WORK/jar" -H 'Content-Type: application/json' -d "{\"name\":\"$1\"}" "http://127.0.0.1:$PORT/api/boards" >/dev/null; }
boards() { curl -s -b "$WORK/jar" "http://127.0.0.1:$PORT/api/boards" | python3 -c 'import sys,json; print(",".join(sorted(b["name"] for b in json.load(sys.stdin)["owned"])))'; }
settle() { sleep 5; } # copying runs every second

echo "1. boards are made and copied"
up && ok "the app and the copying start" || bad "the app and the copying start"
login; make_board Pierwsza; make_board Druga; settle
check "two boards exist" '[ "$(boards)" = "Druga,Pierwsza" ]'

echo "2. the volume is lost, and the database comes back by itself"
dc down -v >/dev/null 2>&1
up && ok "a new server comes up" || bad "a new server comes up"
login
check "the boards are back from the copy" '[ "$(boards)" = "Druga,Pierwsza" ]'

echo "3. restore.sh goes back to a chosen moment"
settle; T1=$(date -u +%Y-%m-%dT%H:%M:%SZ); sleep 2
make_board Trzecia; settle
check "a third board exists" '[ "$(boards)" = "Druga,Pierwsza,Trzecia" ]'
sh ./restore.sh "$T1" >/dev/null 2>&1 || bad "restore.sh ran"
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 1; done
login
check "the third board is gone after the restore" '[ "$(boards)" = "Druga,Pierwsza" ]'
check "what was there was moved aside, not deleted" 'dc run --rm shell ls /data/before-restore 2>/dev/null | grep -q .'

echo "4. copying goes on after the restore"
make_board Czwarta; settle
check "no errors in the log of the copying" '! dc logs litestream 2>&1 | grep -qi "level=ERROR"'
dc down -v >/dev/null 2>&1
up >/dev/null 2>&1 || true
login
check "after another loss all is back, including the board made after the restore" '[ "$(boards)" = "Czwarta,Druga,Pierwsza" ]'

if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
