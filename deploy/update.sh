#!/bin/sh
# Brings the app on this machine up to the newest image of the tag it follows, and goes back to
# the previous one when the new one does not come up (ADR 0014). Run by the systemd timer;
# safe to run by hand. Needs docker, docker compose and curl.
set -eu

cd "$(dirname "$0")"
PORT=${PORT:-8080}
IMAGE=ghcr.io/maciekgangus/inkroom
TAG=${INKROOM_TAG:-latest}

healthy() {
	for _ in $(seq 1 30); do
		curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null && return 0
		sleep 1
	done
	return 1
}

before=$(docker image inspect --format '{{.Id}}' "$IMAGE:$TAG" 2>/dev/null || true)
docker compose pull --quiet
after=$(docker image inspect --format '{{.Id}}' "$IMAGE:$TAG")

if [ "$before" = "$after" ] && docker compose ps --status running --quiet | grep -q .; then
	echo "already up to date ($TAG)"
	exit 0
fi

# Keep the image that worked, under a name of its own, in case the new one does not.
[ -n "$before" ] && docker tag "$before" "$IMAGE:previous"

docker compose up -d --remove-orphans
if healthy; then
	echo "updated to $TAG ($after)"
	docker image prune -f >/dev/null
	exit 0
fi

echo "the new image did not come up; going back to the previous one" >&2
if [ -n "$before" ]; then
	INKROOM_TAG=previous docker compose up -d --remove-orphans
	healthy || echo "the previous image does not answer either" >&2
fi
exit 1
