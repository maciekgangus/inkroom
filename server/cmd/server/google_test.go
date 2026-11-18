package main

import (
	"net/http"
	"strings"
	"testing"
)

func noRedirect(t *testing.T, url string) *http.Response {
	t.Helper()
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func TestGoogleIsOffUntilConfigured(t *testing.T) {
	srv, a, _ := testApp(t)
	if m := decode(t, call(t, srv, "GET", "/api/config", "", nil)); m["google"] != false {
		t.Fatalf("config = %v", m)
	}
	for _, p := range []string{"/api/auth/google/start", "/api/auth/google/callback"} {
		if resp := noRedirect(t, srv.URL+p); resp.StatusCode != http.StatusNotFound {
			t.Fatalf("%s = %d", p, resp.StatusCode)
		}
	}
	a.configureGoogle("cid", "secret", "")
	if m := decode(t, call(t, srv, "GET", "/api/config", "", nil)); m["google"] != true {
		t.Fatalf("config = %v", m)
	}
	resp := noRedirect(t, srv.URL+"/api/auth/google/start")
	if resp.StatusCode != http.StatusFound || !strings.HasPrefix(resp.Header.Get("Location"), "https://accounts.google.com/o/oauth2/v2/auth?") {
		t.Fatalf("start = %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
}

func TestGoogleStaysOffWithHalfAConfiguration(t *testing.T) {
	_, a, _ := testApp(t)
	a.configureGoogle("cid", "", "")
	if a.auth.GoogleEnabled() {
		t.Fatal("enabled without a secret")
	}
}
