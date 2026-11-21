#!/bin/sh
# PostToolUse hook for Bash: after a release tag is pushed (`git push origin vX.Y.Z`), name the new
# graphify communities in the background. Labels use an LLM (the local claude CLI), so this runs once per
# release instead of after every merge; --missing-only keeps existing names and only names new ones.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
case "$cmd" in
*"git push"*" v"[0-9]*) ;;
*) exit 0 ;;
esac
dir=${CLAUDE_PROJECT_DIR:-$(pwd)}
[ -f "$dir/graphify-out/graph.json" ] || exit 0
log=${HOME}/.cache/graphify-relabel.log
mkdir -p "$(dirname "$log")"
(
	cd "$dir" || exit 0
	{
		echo "== $(date -Is) relabel after $cmd"
		${GRAPHIFY_BIN:-graphify} label . --backend=claude-cli --missing-only
	} >>"$log" 2>&1
) </dev/null >/dev/null 2>&1 &
jq -n '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"graphify: a release tag was pushed, so community labels are being refreshed in the background (log: ~/.cache/graphify-relabel.log)."}}'
