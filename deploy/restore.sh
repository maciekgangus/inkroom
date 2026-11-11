#!/bin/sh
# Brings the database back from the copies in R2 (ADR 0016).
#   ./restore.sh                        the newest copy
#   ./restore.sh 2026-11-12T09:30:00Z   the database as it was at that moment (UTC)
# What is on the server now is not deleted: it is moved to /data/before-restore/<date> on the
# volume. The app and the copying are stopped for a moment and started again at the end.
set -eu

cd "$(dirname "$0")"
AT=${1:-}

docker compose stop app litestream

docker compose run --rm shell sh -c '
	set -e
	d=/data/before-restore/$(date +%Y%m%d-%H%M%S)
	mkdir -p "$d"
	for f in /data/inkroom.db /data/inkroom.db-wal /data/inkroom.db-shm /data/inkroom.db-litestream; do
		[ -e "$f" ] && mv "$f" "$d"/
	done
	echo "what was here is now in $d (inside the data volume)"
'

if [ -n "$AT" ]; then
	docker compose run --rm litestream restore -config /etc/litestream.yml -timestamp "$AT" -o /data/inkroom.db /data/inkroom.db
else
	docker compose run --rm litestream restore -config /etc/litestream.yml -o /data/inkroom.db /data/inkroom.db
fi

docker compose up -d
echo "restored${AT:+ to $AT}; check: docker compose logs --tail 20 litestream"
