#!/usr/bin/env bash
# PostToolUse hook: format, lint and test the file Claude just edited.
# Reads the hook JSON on stdin; exit 2 feeds stderr back to Claude.
set -u
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$f" ] || exit 0
out=""

case "$f" in
  "$root"/server/*.go)
    cd "$root/server" || exit 0
    gofmt -w "$f"
    out+=$(go vet ./... 2>&1)
    out+=$(go test ./... 2>&1 | grep -v '^ok' )
    ;;
  "$root"/web/*.ts|"$root"/web/*.tsx|"$root"/web/*.json)
    cd "$root/web" || exit 0
    npx biome check --write "$f" 2>&1 | grep -E 'error|×' >/tmp/biome.$$ ; out+=$(cat /tmp/biome.$$); rm -f /tmp/biome.$$
    out+=$(npm test 2>&1 | grep -E 'FAIL|Error|failed' )
    ;;
  *) exit 0 ;;
esac

if [ -n "$out" ]; then
  printf '%s\n' "$out" >&2
  exit 2
fi
