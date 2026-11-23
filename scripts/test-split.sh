#!/bin/sh
# The split of ADR 0024 end to end, locally: the stack (deploy/observability) and the agent
# (deploy/agent) as projects of their own, and a fake "app" project (its own network, a container named
# `app` that logs JSON and serves /metrics on 9100). Checks that logs and `up{job="app"}` reach the stack
# through the LAN address, and that `up` stops arriving when the app is gone. Needs docker.
set -eu
cd "$(dirname "$0")/.."
LAN_IP=${LAN_IP:-$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')}
W=$(mktemp -d)
export LAN_IP GF_SECURITY_ADMIN_PASSWORD=test TUNNEL_TOKEN=unused-in-this-test LOKI_PORT=13100 PROMETHEUS_PORT=19090 GRAFANA_PORT=13000
export LOKI_URL=http://$LAN_IP:13100 PROMETHEUS_URL=http://$LAN_IP:19090 APP_PROJECT=splitapp APP_NETWORK=splitapp_default
stack() { docker compose -f deploy/observability/docker-compose.yml "$@"; }
agent() { docker compose -f deploy/agent/docker-compose.yml "$@"; }
fakeapp() { docker compose -p splitapp -f "$W/app.yml" "$@"; }
cleanup() { fakeapp down -v >/dev/null 2>&1; agent down -v >/dev/null 2>&1; stack down -v >/dev/null 2>&1; rm -rf "$W"; }
trap cleanup EXIT
cat > "$W/app.py" <<'Y'
import http.server, threading, time, json
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(s):
        s.send_response(200); s.end_headers(); s.wfile.write(b"inkroom_rooms_active 1\n")
    def log_message(*a): pass
threading.Thread(target=http.server.HTTPServer(("", 9100), H).serve_forever, daemon=True).start()
while True:
    print(json.dumps({"level": "INFO", "msg": "hello from the fake app", "service": "app"}), flush=True)
    time.sleep(3)
Y
cat > "$W/app.yml" <<Y
services:
  app:
    image: python:3.13-alpine
    command: python /app.py
    volumes:
      - $W/app.py:/app.py:ro,z
Y
# cloudflared would dial out with a fake token: the stack's other services are what is under test.
stack up -d loki prometheus grafana >/dev/null
fakeapp up -d >/dev/null
agent up -d >/dev/null
q() { curl -sG "$1" --data-urlencode "query=$2" | tr -d '\n'; }
ok=0
for i in $(seq 1 40); do
	logs=$(q "http://$LAN_IP:13100/loki/api/v1/query" 'count_over_time({service="app",container="splitapp-app-1"}[5m])')
	up=$(q "http://$LAN_IP:19090/api/v1/query" 'up{job="app"}')
	cad=$(q "http://$LAN_IP:19090/api/v1/query" 'count(container_start_time_seconds)')
	case "$logs" in *'"value"'*) case "$up" in *'"1"]'*) case "$cad" in *'"value"'*) ok=1; break ;; esac ;; esac ;; esac
	sleep 3
done
[ $ok = 1 ] || { echo "FAIL: logs=$logs up=$up cadvisor=$cad"; exit 1; }
echo "arrived: app logs in Loki, up{job=app}=1, container metrics in Prometheus (through $LAN_IP)"
fakeapp stop >/dev/null
for i in $(seq 1 20); do
	up=$(q "http://$LAN_IP:19090/api/v1/query" 'up{job="app"}')
	case "$up" in *'"0"]'*) echo "OK: app stopped, up{job=app}=0 (the alert has data to fire on)"; exit 0 ;; esac
	sleep 3
done
echo "FAIL: up did not drop: $up"; exit 1
