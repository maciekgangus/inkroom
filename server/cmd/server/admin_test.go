package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

const (
	adminTeam = "team.cloudflareaccess.com"
	adminAud  = "aud-tag-123"
)

func b64u(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// adminEnv is an app with the admin page on, and a way to make tokens Cloudflare would.
type adminEnv struct {
	srv *httptest.Server
	app *app
	key *rsa.PrivateKey
}

func newAdminEnv(t *testing.T, configure bool) adminEnv {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	certs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k1", "kty": "RSA", "n": b64u(key.N.Bytes()), "e": b64u(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(certs.Close)
	srv, a, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	if configure {
		a.configureAdmin(adminTeam, adminAud)
		a.admin.CertsURL = certs.URL
	}
	return adminEnv{srv, a, key}
}

func (e adminEnv) token(t *testing.T, over map[string]any) string {
	t.Helper()
	c := map[string]any{"iss": "https://" + adminTeam, "aud": []string{adminAud}, "email": "owner@example.com", "exp": time.Now().Add(time.Hour).Unix()}
	for k, v := range over {
		c[k] = v
	}
	h, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "k1"})
	cj, _ := json.Marshal(c)
	in := b64u(h) + "." + b64u(cj)
	sum := sha256.Sum256([]byte(in))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, e.key, crypto.SHA256, sum[:])
	return in + "." + b64u(sig)
}

// do calls the app; token is sent as Cloudflare would, changing is true for a state change.
func (e adminEnv) do(t *testing.T, method, path, token string, changing bool, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Cf-Access-Jwt-Assertion", token)
	}
	if changing {
		req.Header.Set("X-Admin-Request", "1")
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(b)
}

var adminRoutes = []struct{ method, path string }{
	{"GET", "/admin"},
	{"GET", "/api/admin/feedback"},
	{"POST", "/api/admin/feedback/1/read"},
	{"DELETE", "/api/admin/feedback/1"},
}

func TestAdminIsHiddenUntilConfigured(t *testing.T) {
	e := newAdminEnv(t, false)
	for _, r := range adminRoutes {
		resp, _ := e.do(t, r.method, r.path, "whatever", true, `{"read":true}`)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s without configuration = %d, want 404", r.method, r.path, resp.StatusCode)
		}
	}
}

func TestAdminNeedsAValidToken(t *testing.T) {
	e := newAdminEnv(t, true)
	bad := map[string]string{
		"none":          "",
		"junk":          "abc.def.ghi",
		"wrong aud":     e.token(t, map[string]any{"aud": []string{"other"}}),
		"expired":       e.token(t, map[string]any{"exp": time.Now().Add(-time.Hour).Unix()}),
		"wrong team":    e.token(t, map[string]any{"iss": "https://evil.cloudflareaccess.com"}),
		"service token": e.token(t, map[string]any{"email": ""}),
	}
	for name, tok := range bad {
		for _, r := range adminRoutes {
			resp, body := e.do(t, r.method, r.path, tok, true, `{"read":true}`)
			if resp.StatusCode != http.StatusNotFound {
				t.Errorf("%s: %s %s = %d, want 404", name, r.method, r.path, resp.StatusCode)
			}
			if strings.Contains(strings.ToLower(body), "admin") {
				t.Errorf("%s: the answer gives the page away: %q", name, body)
			}
		}
	}
}

func TestAdminPageHasItsHeaders(t *testing.T) {
	e := newAdminEnv(t, true)
	resp, body := e.do(t, "GET", "/admin", e.token(t, nil), false, "")
	if resp.StatusCode != http.StatusOK || !strings.Contains(body, "<html") {
		t.Fatalf("page = %d %q", resp.StatusCode, body)
	}
	if !strings.Contains(resp.Header.Get("X-Robots-Tag"), "noindex") {
		t.Error("no noindex")
	}
	if !strings.Contains(resp.Header.Get("Cache-Control"), "no-store") {
		t.Error("cacheable")
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
		t.Errorf("type %q", resp.Header.Get("Content-Type"))
	}
}

func TestAdminListsMarksAndDeletesFeedback(t *testing.T) {
	e := newAdminEnv(t, true)
	tok := e.token(t, nil)
	now := time.Now()
	for i, m := range []string{"old", "new"} {
		if err := e.app.st.AddFeedback(store.Feedback{Person: "g:1", Name: "Ola", Message: m, Page: "/b/x", Screen: "1x1", UserAgent: "UA", At: now.Add(time.Duration(i) * time.Minute)}); err != nil {
			t.Fatal(err)
		}
	}
	resp, body := e.do(t, "GET", "/api/admin/feedback", tok, false, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list = %d", resp.StatusCode)
	}
	var list []struct {
		ID        int64  `json:"id"`
		At        string `json:"at"`
		Name      string `json:"name"`
		Message   string `json:"message"`
		Page      string `json:"page"`
		Screen    string `json:"screen"`
		UserAgent string `json:"userAgent"`
		Read      bool   `json:"read"`
	}
	if err := json.Unmarshal([]byte(body), &list); err != nil {
		t.Fatalf("%v in %q", err, body)
	}
	if len(list) != 2 || list[0].Message != "new" || list[1].Message != "old" || list[0].Name != "Ola" || list[0].Page != "/b/x" || list[0].UserAgent != "UA" || list[0].Read || list[0].At == "" {
		t.Fatalf("list: %+v", list)
	}
	id := strconv.FormatInt(list[0].ID, 10)

	if resp, _ := e.do(t, "POST", "/api/admin/feedback/"+id+"/read", tok, true, `{"read":true}`); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("mark = %d", resp.StatusCode)
	}
	_, body = e.do(t, "GET", "/api/admin/feedback", tok, false, "")
	if !strings.Contains(body, `"read":true`) {
		t.Fatalf("not read: %s", body)
	}
	if resp, _ := e.do(t, "DELETE", "/api/admin/feedback/"+id, tok, true, ""); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	if resp, _ := e.do(t, "DELETE", "/api/admin/feedback/"+id, tok, true, ""); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("delete again = %d, want 404", resp.StatusCode)
	}
	if all, _ := e.app.st.ListFeedback(10); len(all) != 1 {
		t.Fatalf("%d left", len(all))
	}
}

func TestAdminChangesNeedTheRequestHeader(t *testing.T) {
	e := newAdminEnv(t, true)
	tok := e.token(t, nil)
	_ = e.app.st.AddFeedback(store.Feedback{Person: "g:1", Message: "keep", At: time.Now()})
	all, _ := e.app.st.ListFeedback(1)
	id := strconv.FormatInt(all[0].ID, 10)
	// what a page of another site could do with the person's Cloudflare cookie: no custom header
	if resp, _ := e.do(t, "DELETE", "/api/admin/feedback/"+id, tok, false, ""); resp.StatusCode != http.StatusForbidden {
		t.Errorf("delete without the header = %d, want 403", resp.StatusCode)
	}
	if resp, _ := e.do(t, "POST", "/api/admin/feedback/"+id+"/read", tok, false, `{"read":true}`); resp.StatusCode != http.StatusForbidden {
		t.Errorf("mark without the header = %d, want 403", resp.StatusCode)
	}
	if all, _ := e.app.st.ListFeedback(1); len(all) != 1 || all[0].Read {
		t.Fatal("the note was changed")
	}
}
