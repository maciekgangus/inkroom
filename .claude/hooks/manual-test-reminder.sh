#!/bin/sh
# PostToolUse hook for Bash: after a PR is opened or the test server is started, remind the
# model to walk through the feature by hand in a browser (Playwright with Chromium) before reporting it.
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
case "$cmd" in
*"gh pr create"*|*"test-server/server.sh"*" start"*) ;;
*) exit 0 ;;
esac
msg='Przed zgłoszeniem funkcji użytkownikowi: odpal serwer testowy (/test-server) i przejdź funkcję w przeglądarce (Playwright z pełnym Chromium z web/, localhost:<port>, konto test), sprawdź konsolę i zrzut ekranu, napraw to, co wyjdzie, dopiero potem zgłoś. Before reporting the feature: run it in a browser (Playwright, Chromium) against the test server, check console and screenshot, fix what shows up, then report.'
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
