#!/bin/sh
# Brings the app on this machine up to the newest image of the tag it follows, and goes back to
# the previous one when the new one does not come up (ADR 0014). Run by the systemd timer;
# safe to run by hand. Needs docker, docker compose and curl.
set -eu

cd "$(dirname "$0")"
PORT=${PORT:-8080}
# The image the compose file runs, with .env and the environment applied (INKROOM_TAG).
REF=$(docker compose config --images | grep '/inkroom:' | head -n 1)
IMAGE=${REF%:*}

healthy() {
	for _ in $(seq 1 30); do
		curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null && return 0
		sleep 1
	done
	return 1
}

before=$(docker image inspect --format '{{.Id}}' "$REF" 2>/dev/null || true)
if ! docker compose pull --quiet; then
	# The image is private (ADR 0014): the usual reason is a missing or expired login.
	echo "could not pull the images: is docker logged in to ghcr.io (docker login ghcr.io)," >&2
	echo "for the user that runs this script, with a token that may read packages?" >&2
	exit 1
fi
after=$(docker image inspect --format '{{.Id}}' "$REF")

if [ "$before" = "$after" ] && docker compose ps --status running --quiet | grep -q .; then
	# The app is current; the tunnel's image may not be, so bring the rest up too (a no-op for
	# what has not changed).
	docker compose up -d --remove-orphans
	echo "already up to date ($REF)"
	exit 0
fi

# Keep the image that worked, under a name of its own, in case the new one does not.
[ -n "$before" ] && docker tag "$before" "$IMAGE:previous"

docker compose up -d --remove-orphans
if healthy; then
	echo "updated to $REF ($after)"
	docker image prune -f >/dev/null
	exit 0
fi

echo "the new image did not come up; going back to the previous one" >&2
if [ -n "$before" ]; then
	INKROOM_TAG=previous docker compose up -d --remove-orphans
	healthy || echo "the previous image does not answer either" >&2
fi
exit 1
