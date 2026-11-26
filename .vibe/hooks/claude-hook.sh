#!/bin/sh
# Runs a Claude Code hook from .claude/hooks/ for Mistral Vibe. Vibe sends the same stdin fields the
# scripts read (tool_input.command, tool_input.file_path), so only the reply is translated:
#   Claude deny (hookSpecificOutput.permissionDecision)  -> Vibe {"decision":"deny","reason":...}
#   Claude additionalContext                             -> Vibe hook_specific_output.additional_context
#   Claude exit 2 + stderr (post-edit.sh)                -> pre_tool: deny; post_tool: additional_context
# Usage: claude-hook.sh <script in .claude/hooks>
in=$(cat)
cwd=$(printf '%s' "$in" | jq -r '.cwd // empty')
[ -n "$cwd" ] && cd "$cwd" 2>/dev/null
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
script="$root/.claude/hooks/$1"
[ -x "$script" ] || exit 0
event=$(printf '%s' "$in" | jq -r '.hook_event_name // empty')
# The scripts match absolute paths under the checkout; make a relative file_path absolute.
in=$(printf '%s' "$in" | jq -c --arg pwd "$(pwd)" 'if (.tool_input.file_path? // "") | test("^[^/]") then .tool_input.file_path = $pwd + "/" + .tool_input.file_path else . end')
errf=$(mktemp)
out=$(printf '%s' "$in" | CLAUDE_PROJECT_DIR="$root" "$script" 2>"$errf")
code=$?
err=$(cat "$errf")
rm -f "$errf"

if [ -n "$out" ]; then
	reason=$(printf '%s' "$out" | jq -r 'select(.hookSpecificOutput.permissionDecision == "deny") | .hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)
	if [ -n "$reason" ]; then
		jq -n --arg r "$reason" '{decision: "deny", reason: $r}'
		exit 0
	fi
	ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
	if [ -n "$ctx" ]; then
		jq -n --arg c "$ctx" '{hook_specific_output: {additional_context: $c}}'
		exit 0
	fi
fi

if [ "$code" -eq 2 ] && [ -n "$err" ]; then
	case "$event" in
	*pre*) jq -n --arg r "$err" '{decision: "deny", reason: $r}' ;;
	*) jq -n --arg c "Checks after the edit failed, fix this:
$err" '{hook_specific_output: {additional_context: $c}}' ;;
	esac
fi
exit 0
