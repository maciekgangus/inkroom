package main

import "testing"

func TestConfigCarriesTheServerVersion(t *testing.T) {
	srv, a, _ := testApp(t)
	if m := decode(t, call(t, srv, "GET", "/api/config", "", nil)); m["version"] != "dev" {
		t.Fatalf("a server of no release says %v, want dev", m["version"])
	}
	a.configureVersion("0.7.1")
	if m := decode(t, call(t, srv, "GET", "/api/config", "", nil)); m["version"] != "0.7.1" {
		t.Fatalf("config = %v", m)
	}
}

func TestVersionOfTheEnvironmentWinsOverTheBuild(t *testing.T) {
	if got := serverVersion("", "0.7.1"); got != "0.7.1" {
		t.Fatalf("build only = %q", got)
	}
	if got := serverVersion("test-2", "0.7.1"); got != "test-2" {
		t.Fatalf("APP_VERSION must win, got %q", got)
	}
	if got := serverVersion("", ""); got != "dev" {
		t.Fatalf("nothing set = %q, want dev", got)
	}
}
