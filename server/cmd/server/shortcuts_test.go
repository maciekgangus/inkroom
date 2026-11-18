package main

import (
	"net/http"
	"testing"
)

func TestShortcutsAreKeptPerAccount(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	ann := register(t, srv, "ann@example.com")
	bob := register(t, srv, "bob@example.com")

	got := decode(t, call(t, srv, "GET", "/api/account/shortcuts", "", &ann))
	if m, _ := got["shortcuts"].(map[string]any); len(m) != 0 {
		t.Fatalf("fresh account has shortcuts: %v", got)
	}
	if c := status(call(t, srv, "PUT", "/api/account/shortcuts", `{"shortcuts":{"pen":"KeyB","eraser":"KeyX"}}`, &ann)); c != http.StatusNoContent {
		t.Fatalf("put = %d", c)
	}
	got = decode(t, call(t, srv, "GET", "/api/account/shortcuts", "", &ann))
	m, _ := got["shortcuts"].(map[string]any)
	if m["pen"] != "KeyB" || m["eraser"] != "KeyX" || len(m) != 2 {
		t.Fatalf("ann = %v", got)
	}
	got = decode(t, call(t, srv, "GET", "/api/account/shortcuts", "", &bob))
	if m, _ := got["shortcuts"].(map[string]any); len(m) != 0 {
		t.Fatalf("bob sees ann's: %v", got)
	}
	// An empty set (reset to the defaults) clears them.
	call(t, srv, "PUT", "/api/account/shortcuts", `{"shortcuts":{}}`, &ann).Body.Close()
	got = decode(t, call(t, srv, "GET", "/api/account/shortcuts", "", &ann))
	if m, _ := got["shortcuts"].(map[string]any); len(m) != 0 {
		t.Fatalf("not cleared: %v", got)
	}
}

func TestShortcutsNeedLoginAndSaneInput(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	if c := status(call(t, srv, "GET", "/api/account/shortcuts", "", nil)); c != http.StatusUnauthorized {
		t.Fatalf("guest get = %d", c)
	}
	if c := status(call(t, srv, "PUT", "/api/account/shortcuts", `{"shortcuts":{}}`, nil)); c != http.StatusUnauthorized {
		t.Fatalf("guest put = %d", c)
	}
	ann := register(t, srv, "ann@example.com")
	long := `{"shortcuts":{"pen":"` + string(make([]byte, 0)) + `KeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}`
	for _, body := range []string{long, `{"shortcuts":{"pen":5}}`, `not json`} {
		if c := status(call(t, srv, "PUT", "/api/account/shortcuts", body, &ann)); c != http.StatusBadRequest {
			t.Fatalf("%q = %d", body, c)
		}
	}
}
