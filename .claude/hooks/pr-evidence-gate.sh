#!/bin/sh
# PreToolUse hook for Bash: block `gh pr create` for a change with UI code until the feature was
# run in a browser against the test server and screenshots were saved (newer than the last commit).
# No jq on this machine: match on the raw JSON from stdin.
input=$(cat)
case "$input" in
*"gh pr create"*) ;;
*) exit 0 ;;
esac
base=$(git merge-base HEAD ${PR_BASE:-origin/main} 2>/dev/null) || exit 0
# Only UI changes need evidence (client sources other than tests and docs).
git diff --name-only "$base" HEAD | grep -E '^web/src/.*\.(tsx|ts|css)$' | grep -vE '\.test\.' >/dev/null || exit 0
root=$(git rev-parse --show-toplevel)
dir="$root/docs/screenshots/$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
head_ts=$(git log -1 --format=%ct)
fresh=""
for f in "$dir"/*.png; do
  [ -f "$f" ] || continue
  [ "$(stat -c %Y "$f")" -ge "$head_ts" ] && fresh=1
done
[ -n "$fresh" ] && exit 0
msg="Zablokowano gh pr create: zmiana dotyka interfejsu, a w $dir nie ma zrzutów ekranu nowszych niż ostatni commit. Odpal /test-server, przejdź funkcję w przeglądarce (Chromium, localhost:8099, konto test; sprawdź konsolę), zapisz zrzuty jako PNG w tym katalogu, dołącz je do opisu PR i pokaż użytkownikowi. Dopiero potem ponów. Blocked: run the feature in a browser against the test server and save screenshots (PNG, newer than the last commit) to that directory first."
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$msg"
