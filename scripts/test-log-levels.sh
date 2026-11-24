#!/bin/sh
# Runs the REAL deploy/observability/config.alloy and loki.yml against a container that prints real
# cloudflared lines, and checks the level each line gets in Loki: a browser closing a request
# (benign) must be WARN, a real failure must stay ERROR (the alert "Błędy w logach" reads ERROR).
# Needs docker; pinned images are read from deploy/docker-compose.yml. Cleans up after itself.
set -eu
cd "$(dirname "$0")/.."
img() { grep -E "image: .*$1" deploy/docker-compose.yml | head -n 1 | awk '{print $2}'; }
LOKI=$(img grafana/loki); ALLOY=$(img grafana/alloy)
P=logleveltest
W=$(mktemp -d); trap 'docker rm -f $P-loki $P-alloy $P-cf >/dev/null 2>&1; docker network rm $P >/dev/null 2>&1; rm -rf "$W"' EXIT
cat > "$W/lines" <<'LINES'
2026-11-23T15:54:31Z ERR  error="stream 797 canceled by remote with error code 0" connIndex=3 event=1 ingressRule=0 originService=http://app:8080
2026-11-23T15:54:31Z ERR Request failed error="stream 793 canceled by remote with error code 0" connIndex=3 dest=https://x.example/api/boards/ab/preview event=0 ip=198.41.200.33 type=http
2026-11-23T15:55:01Z ERR  error="Incoming request ended abruptly: context canceled" connIndex=1 event=1 ingressRule=0 originService=http://app:8080
2026-11-23T15:56:01Z ERR Request failed error="Unable to reach the origin service. The service may be down or it may not be responding to traffic from cloudflared: dial tcp 172.18.0.6:3000: connect: connection refused" connIndex=0 dest=https://logs.example/ event=0 ip=1.2.3.4 type=http
2026-11-23T15:57:01Z ERR Connection terminated error="connection with edge closed" connIndex=2
LINES
docker network create $P >/dev/null
docker run -d --name $P-loki --network $P --network-alias loki -v "$PWD/deploy/observability/loki.yml:/etc/loki/loki.yml:ro,z" -p 127.0.0.1:0:3100 "$LOKI" -config.file=/etc/loki/loki.yml >/dev/null
docker run -d --name $P-alloy --network $P -u 0:0 --pid host -v /:/host:ro,rslave -v /:/rootfs:ro -v /sys:/sys:ro -v /var/run:/var/run:ro -v /var/lib/docker/:/var/lib/docker:ro -v /dev/disk/:/dev/disk:ro -e LOG_PROJECT_FILTER=com.docker.compose.project=$P \
	-v "$PWD/deploy/observability/config.alloy:/etc/alloy/config.alloy:ro,z" -v /var/run/docker.sock:/var/run/docker.sock:ro \
	"$ALLOY" run --storage.path=/tmp/alloy /etc/alloy/config.alloy >/dev/null
sleep 8
docker run -d --name $P-cf --label com.docker.compose.project=$P --label com.docker.compose.service=cloudflared \
	-v "$W/lines:/lines:ro,z" busybox:1.37 sh -c 'cat /lines; sleep 600' >/dev/null
PORT=$(docker port $P-loki 3100/tcp | head -n 1 | sed 's/.*://')
fail=0
for i in $(seq 1 40); do
	out=$(curl -sG "http://127.0.0.1:$PORT/loki/api/v1/query" --data-urlencode 'query=sum by (level) (count_over_time({service="cloudflared"}[10m]))' | tr -d '\n') || true
	case "$out" in *'"level":"'*) [ "$(printf %s "$out" | grep -o '"value"' | wc -l)" -ge 2 ] && break ;; esac
	sleep 2
done
warn=$(printf %s "$out" | grep -o '"level":"WARN"},"value":\[[0-9.]*,"[0-9]*"' | grep -o '[0-9]*"$' | tr -d '"' || true)
err=$(printf %s "$out" | grep -o '"level":"ERROR"},"value":\[[0-9.]*,"[0-9]*"' | grep -o '[0-9]*"$' | tr -d '"' || true)
echo "WARN=${warn:-0} (want 3), ERROR=${err:-0} (want 2)"
[ "${warn:-0}" = 3 ] && [ "${err:-0}" = 2 ] && echo "OK" || { echo "FAIL"; fail=1; }
exit $fail
