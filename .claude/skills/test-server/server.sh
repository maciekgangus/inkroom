#!/bin/sh
# Starts, stops or reports on a local test server for the checkout it is run in.
#   server.sh start [port]    build the client and the server, start in the background
#   server.sh stop [port]
#   server.sh status [port]
# FRESH=1 starts with an empty database. The default port is 8099. State (pid, log, database)
# lives in ~/.cache/inkroom-test-server-<port>, so every checkout and port has its own.
set -eu

ACTION=${1:-start}
PORT=${2:-8099}
ROOT=$(git rev-parse --show-toplevel)
STATE="$HOME/.cache/inkroom-test-server-$PORT"
PIDFILE="$STATE/pid"
LOG="$STATE/log"

running() {
	[ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

stop() {
	if running; then
		kill "$(cat "$PIDFILE")" 2>/dev/null || true
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			running || break
			sleep 0.5
		done
		echo "stopped the server on port $PORT"
	else
		echo "no test server is running on port $PORT"
	fi
	rm -f "$PIDFILE"
}

lan_ip() {
	ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}'
}

urls() {
	echo "  on this PC:  http://localhost:$PORT"
	ip=$(lan_ip)
	[ -n "$ip" ] && echo "  on the LAN:  http://$ip:$PORT   (an iPad on the same Wi-Fi; port may need: sudo firewall-cmd --add-port=$PORT/tcp)"
	echo "  account:     test@example.test / test-user-1234  (login: test@example.test or test)"
	echo "  registering: works with Cloudflare's test captcha (needs internet for the widget)"
	echo "  from:        $ROOT"
	echo "  log:         $LOG"
	echo "  stop with:   $0 stop $PORT"
}

case "$ACTION" in
start)
	stop >/dev/null
	mkdir -p "$STATE"
	[ "${FRESH:-}" = 1 ] && rm -rf "$STATE/data"
	mkdir -p "$STATE/data"
	cd "$ROOT/web"
	[ -d node_modules ] || npm ci --silent
	npm run build --silent >/dev/null
	(cd "$ROOT/server" && go build -o "$STATE/server" ./cmd/server)
	# The public dev account of the project (see CLAUDE.md) and Cloudflare's published Turnstile
	# test keys, so nothing secret is involved.
	DATA_DIR="$STATE/data" PORT="$PORT" STATIC_DIR="$ROOT/web/dist" \
		ADMIN_DEV_OPEN=1 SEED_USER_EMAIL=test@example.test SEED_USER_PASSWORD=test-user-1234 \
		TURNSTILE_SITE_KEY=1x00000000000000000000AA TURNSTILE_SECRET=1x0000000000000000000000000000000AA \
		nohup "$STATE/server" >"$LOG" 2>&1 &
	echo $! >"$PIDFILE"
	for _ in $(seq 1 40); do
		curl -fs "http://localhost:$PORT/healthz" >/dev/null && break
		sleep 0.5
	done
	if curl -fs "http://localhost:$PORT/healthz" >/dev/null; then
		echo "test server is up:"
		urls
	else
		echo "the server did not come up; last log lines:" >&2
		tail -n 15 "$LOG" >&2
		exit 1
	fi
	;;
stop)
	stop
	;;
status)
	if running; then
		echo "test server is running (pid $(cat "$PIDFILE")):"
		urls
	else
		echo "no test server is running on port $PORT"
	fi
	;;
*)
	echo "usage: $0 start|stop|status [port]" >&2
	exit 2
	;;
esac
