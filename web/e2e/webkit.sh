#!/bin/sh
# Runs the iPad tests in WebKit. Playwright's WebKit does not run on Fedora, so the tests run in
# Playwright's own container (podman) against a server started here (ADR 0012).
set -eu
cd "$(dirname "$0")/.."
PORT=8199
IMAGE=mcr.microsoft.com/playwright:v$(node -p "require('@playwright/test/package.json').version")-noble

npm run build --silent
DATA_DIR=$(mktemp -d)
(cd ../server && go build -o "$DATA_DIR/server" ./cmd/server)
DATA_DIR="$DATA_DIR" PORT=$PORT STATIC_DIR=../web/dist "$DATA_DIR/server" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$DATA_DIR"' EXIT
for _ in $(seq 1 60); do
	curl -fs "http://localhost:$PORT/healthz" >/dev/null && break
	sleep 1
done

podman run --rm --network host --ipc host -v "$PWD:/work:Z" -w /work \
	-e E2E_ENGINE=webkit -e E2E_BASE_URL="http://localhost:$PORT" \
	"$IMAGE" npx playwright test -c e2e/playwright.config.ts "$@"
