package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maciekgangus/inkroom/server/internal/auth"
)

// testCaptcha accepts the token "ok" and nothing else.
type testCaptcha struct{}

func (testCaptcha) Verify(_ context.Context, token, _ string) error {
	if token == "ok" {
		return nil
	}
	return errors.New("bad token")
}

var _ auth.Captcha = testCaptcha{}

func TestTheRegisterPageIsTheClientApp(t *testing.T) {
	dir := t.TempDir()
	if err := writeFile(dir+"/index.html", "<html>app</html>"); err != nil {
		t.Fatal(err)
	}
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "x.db"), dir)
	resp, err := http.Get(srv.URL + "/register")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "app") {
		t.Fatalf("GET /register = %d %q", resp.StatusCode, body)
	}
}

func TestTheClientLearnsTheSiteKeyFromTheServer(t *testing.T) {
	srv, a, _ := testApp(t)
	a.configureCaptcha("site-key-123", "secret")
	m := decode(t, call(t, srv, "GET", "/api/config", "", nil))
	if m["turnstileSiteKey"] != "site-key-123" {
		t.Fatalf("config = %v", m)
	}
	if strings.Contains(strings.Join([]string{m["turnstileSiteKey"].(string)}, ""), "secret") {
		t.Fatal("the secret leaked")
	}
}

func TestWithoutKeysRegistrationStaysClosed(t *testing.T) {
	srv, a, _ := testApp(t)
	a.auth.Captcha = nil
	a.configureCaptcha("", "")
	resp := call(t, srv, "POST", "/api/register", `{"email":"a@example.com","username":"abc","password":"password1","captcha":"ok"}`, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("register without keys = %d", resp.StatusCode)
	}
}

func TestConfiguredKeysTurnTheCaptchaOn(t *testing.T) {
	_, a, _ := testApp(t)
	a.auth.Captcha = nil
	a.configureCaptcha("site", "secret")
	if _, ok := a.auth.Captcha.(auth.Turnstile); !ok {
		t.Fatalf("captcha = %T, want a Turnstile verifier", a.auth.Captcha)
	}
}

func TestTheWebManifestIsServedWithItsOwnContentType(t *testing.T) {
	dir := t.TempDir()
	if err := writeFile(dir+"/site.webmanifest", `{"name":"Inkroom"}`); err != nil {
		t.Fatal(err)
	}
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "x.db"), dir)
	resp, err := http.Get(srv.URL + "/site.webmanifest")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Fatalf("Content-Type = %q", ct)
	}
}
