#!/bin/sh
# Tests update.sh with stand-ins for docker, curl and sleep: nothing real is touched.
#   sh deploy/test-update.sh
# The conditions of check() are code in strings, run by eval; $out and $rc are read by them.
# shellcheck disable=SC2016,SC2034
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir "$T/bin"

# docker: ids of the images are kept in files, see the cases below.
cat >"$T/bin/docker" <<'EOF'
#!/bin/sh
S=$STATE
case "$*" in
"compose config --images") printf 'ghcr.io/maciekgangus/inkroom:%s\ncloudflare/cloudflared:latest\n' "${INKROOM_TAG:-latest}" ;;
"image inspect --format {{.Id}} "*:previous) cat "$S/previous" 2>/dev/null || exit 1 ;;
"image inspect --format {{.Id}} "*) cat "$S/latest" 2>/dev/null || exit 1 ;;
"compose pull --quiet") [ -f "$S/next" ] && cp "$S/next" "$S/latest"; echo "pull" >>"$S/log" ;;
"compose ps --status running --quiet") [ -f "$S/running" ] && echo container ;;
"tag "*) echo "$2" >"$S/previous"; echo "tag $2 previous" >>"$S/log" ;;
"compose up -d --remove-orphans")
	echo "up ${INKROOM_TAG:-latest}" >>"$S/log"
	touch "$S/running"
	if [ "${INKROOM_TAG:-latest}" = previous ]; then cp "$S/previous" "$S/serving"; else cp "$S/latest" "$S/serving"; fi ;;
"image prune -f") echo "prune" >>"$S/log" ;;
*) echo "unexpected docker $*" >&2; exit 99 ;;
esac
EOF
# curl answers by the health of the image being served; sleep does not wait.
cat >"$T/bin/curl" <<'EOF'
#!/bin/sh
[ "$(cat "$STATE/health_$(cat "$STATE/serving")" 2>/dev/null)" = ok ] || exit 22
EOF
printf '#!/bin/sh\nexit 0\n' >"$T/bin/sleep"
chmod +x "$T/bin/"*

fails=0
run() { # name
	STATE="$T/state"; export STATE
	rm -rf "$STATE"; mkdir "$STATE"
}
check() { # description condition (shell code, true when the case is as it should be)
	if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi
}
update() { PATH="$T/bin:$PATH" sh "$HERE/update.sh" 2>&1; }
has() { grep -q "$1" "$STATE/log"; }

run unchanged
echo A >"$STATE/latest"; echo A >"$STATE/next"; touch "$STATE/running"
rc=0; out=$(update) || rc=$?
check "an image that has not changed is left alone (the rest of the stack is refreshed)" '[ $rc -eq 0 ] && ! has "^tag" && ! has "^prune" && has "^up latest" && echo "$out" | grep -q "already up to date"'

run healthy
echo A >"$STATE/latest"; echo B >"$STATE/next"; touch "$STATE/running"; echo ok >"$STATE/health_B"
rc=0; out=$(update) || rc=$?
check "a new image that comes up is kept" '[ $rc -eq 0 ] && has "^up latest" && echo "$out" | grep -q "updated"'
check "the old image is saved as previous" '[ "$(cat "$STATE/previous")" = A ]'
check "old images are pruned after a good update" 'has "^prune"'

run broken
echo A >"$STATE/latest"; echo B >"$STATE/next"; touch "$STATE/running"
echo ok >"$STATE/health_A"; echo bad >"$STATE/health_B"
rc=0; out=$(update) || rc=$?
check "a new image that does not come up fails the update" '[ $rc -eq 1 ]'
check "and the previous one is started again" 'has "^up previous"'
check "and it is the previous one that is served" '[ "$(cat "$STATE/serving")" = A ]'
check "and nothing is pruned" '! has "^prune"'

run first
echo B >"$STATE/next"; echo ok >"$STATE/health_B"
rc=0; out=$(update) || rc=$?
check "a first installation works, with no previous image to save" '[ $rc -eq 0 ] && ! has "^tag" && has "^up latest"'

run pinned
echo A >"$STATE/latest"; echo B >"$STATE/next"; touch "$STATE/running"; echo ok >"$STATE/health_B"
rc=0; out=$(INKROOM_TAG=main update) || rc=$?
check "a tag named in .env or the environment is the one that is followed" '[ $rc -eq 0 ] && echo "$out" | grep -q "inkroom:main"'

run tunnel
echo A >"$STATE/latest"; echo A >"$STATE/next"; touch "$STATE/running"
rc=0; out=$(update) || rc=$?
check "the image of the tunnel is not mistaken for the app's" '[ $rc -eq 0 ] && echo "$out" | grep -q "inkroom:latest" && ! echo "$out" | grep -q cloudflared'

if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
