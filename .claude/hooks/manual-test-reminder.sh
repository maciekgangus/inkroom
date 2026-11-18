#!/bin/sh
# PostToolUse hook for Bash: after a PR is opened or the test server is started, remind the
# model to walk through the feature by hand in Claude in Chrome before reporting it.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
case "$cmd" in
*"gh pr create"*|*"test-server/server.sh"*" start"*) ;;
*) exit 0 ;;
esac
msg='Przed zgłoszeniem funkcji użytkownikowi: odpal serwer testowy (/test-server) i przejdź ręcznie przez funkcję w Claude in Chrome (nowa karta, localhost:8099, konto test), sprawdź konsolę i zrzut ekranu, napraw to, co wyjdzie, dopiero potem zgłoś. Before reporting the feature: run it by hand in Claude in Chrome against the test server, check console and screenshot, fix what shows up, then report.'
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
