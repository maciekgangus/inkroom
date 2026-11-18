package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// fakeGoogle stands in for Google's token endpoint. It checks the PKCE verifier against the
// challenge of the authorization request and answers with an ID token built from claims.
type fakeGoogle struct {
	t         *testing.T
	srv       *httptest.Server
	challenge string
	nonce     string
	claims    map[string]any // overrides for the ID token claims
	status    int            // non-zero: the token endpoint fails with it
	form      url.Values
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	f := &fakeGoogle{t: t}
	f.srv = httptest.NewServer(http.HandlerFunc(f.token))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGoogle) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		f.t.Fatal(err)
	}
	f.form = r.PostForm
	if f.status != 0 {
		http.Error(w, "nope", f.status)
		return
	}
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != f.challenge {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	claims := map[string]any{
		"iss": "https://accounts.google.com", "aud": "cid", "sub": "g-1",
		"email": "ala@example.org", "email_verified": true, "nonce": f.nonce,
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	for k, v := range f.claims {
		if v == nil {
			delete(claims, k)
		} else {
			claims[k] = v
		}
	}
	payload, _ := json.Marshal(claims)
	idToken := "eyJhbGciOiJSUzI1NiJ9." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
	_ = json.NewEncoder(w).Encode(map[string]string{"id_token": idToken})
}

func googleService(t *testing.T) (*Service, *fakeGoogle, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	s := New(st)
	f := newFakeGoogle(t)
	s.Google = &Google{
		ClientID: "cid", ClientSecret: "secret",
		AuthURL: "https://accounts.example/auth", TokenURL: f.srv.URL,
		PublicURL: "https://ink.test",
	}
	return s, f, st
}

// startGoogle runs the first leg and returns the state cookie and the authorization request.
func startGoogle(t *testing.T, s *Service, f *fakeGoogle) (*http.Cookie, url.Values) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.GoogleStart(rec, httptest.NewRequest("GET", "/api/auth/google/start", nil))
	if rec.Code != http.StatusFound {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	q := loc.Query()
	f.challenge, f.nonce = q.Get("code_challenge"), q.Get("nonce")
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == googleCookie {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("no state cookie")
	}
	return cookie, q
}

func callbackGoogle(s *Service, cookie *http.Cookie, query string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", "/api/auth/google/callback?"+query, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.GoogleCallback(rec, req)
	return rec
}

func sessionCookie(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName && c.Value != "" {
			return c
		}
	}
	return nil
}

func TestGoogleStartRequestsPKCEAndState(t *testing.T) {
	s, f, _ := googleService(t)
	cookie, q := startGoogle(t, s, f)
	if q.Get("client_id") != "cid" || q.Get("response_type") != "code" || q.Get("scope") != "openid email profile" {
		t.Fatalf("query %v", q)
	}
	if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("nonce") == "" {
		t.Fatalf("PKCE or nonce missing: %v", q)
	}
	if q.Get("redirect_uri") != "https://ink.test/api/auth/google/callback" {
		t.Fatalf("redirect_uri %q", q.Get("redirect_uri"))
	}
	if q.Get("state") != cookie.Value || !cookie.HttpOnly || cookie.Path != "/api/auth/google" {
		t.Fatalf("state %q cookie %+v", q.Get("state"), cookie)
	}
}

func TestGoogleLoginCreatesAnAccountWithoutPassword(t *testing.T) {
	s, f, st := googleService(t)
	cookie, q := startGoogle(t, s, f)
	rec := callbackGoogle(s, cookie, "code=abc&state="+q.Get("state"))
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("callback: %d %q", rec.Code, rec.Header().Get("Location"))
	}
	if sessionCookie(rec) == nil {
		t.Fatal("no session")
	}
	u, err := st.UserByGoogleSub("g-1")
	if err != nil || u.Email != "ala@example.org" || u.Username != "ala" || u.Hash != "" {
		t.Fatalf("account %+v, %v", u, err)
	}
	if f.form.Get("client_secret") != "secret" || f.form.Get("redirect_uri") != "https://ink.test/api/auth/google/callback" ||
		f.form.Get("grant_type") != "authorization_code" || f.form.Get("code") != "abc" {
		t.Fatalf("token request %v", f.form)
	}
	// a password login can never succeed for it
	if VerifyPassword(u.Hash, "") {
		t.Fatal("empty password accepted")
	}
}

func TestGoogleLoginReturnsToTheSameAccount(t *testing.T) {
	s, f, st := googleService(t)
	for i := 0; i < 2; i++ {
		cookie, q := startGoogle(t, s, f)
		if rec := callbackGoogle(s, cookie, "code=abc&state="+q.Get("state")); sessionCookie(rec) == nil {
			t.Fatalf("login %d failed: %d", i, rec.Code)
		}
	}
	var n int
	for _, name := range []string{"ala"} {
		if _, err := st.UserByLogin(name); err == nil {
			n++
		}
	}
	if n != 1 {
		t.Fatal("expected exactly one account")
	}
	if _, err := st.UserByLogin("ala2"); err == nil {
		t.Fatal("a second account was created")
	}
}

func TestGoogleLinksAPasswordAccountOfTheSameEmailAndDropsItsPassword(t *testing.T) {
	s, f, st := googleService(t)
	hash, _ := HashPassword("longpassword")
	old, err := st.CreateAccount("ala@example.org", "ala", hash)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.CreateSession("old", old.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	cookie, q := startGoogle(t, s, f)
	rec := callbackGoogle(s, cookie, "code=abc&state="+q.Get("state"))
	if sessionCookie(rec) == nil {
		t.Fatalf("login failed: %d", rec.Code)
	}
	u, err := st.UserByGoogleSub("g-1")
	if err != nil || u.ID != old.ID {
		t.Fatalf("not linked to the existing account: %+v, %v", u, err)
	}
	if u.Hash != "" {
		t.Fatal("the password of the linked account was kept")
	}
	if _, err := st.SessionUser("old", time.Now()); err == nil {
		t.Fatal("an old session survived")
	}
}

func TestGoogleRefusesWhatItCannotTrust(t *testing.T) {
	cases := []struct {
		name   string
		claims map[string]any
		status int
	}{
		{"unverified e-mail", map[string]any{"email_verified": false}, 0},
		{"e-mail verified as a string false", map[string]any{"email_verified": "false"}, 0},
		{"missing e-mail", map[string]any{"email": nil}, 0},
		{"other audience", map[string]any{"aud": "someone-else"}, 0},
		{"other issuer", map[string]any{"iss": "https://evil.example"}, 0},
		{"expired", map[string]any{"exp": time.Now().Add(-time.Minute).Unix()}, 0},
		{"wrong nonce", map[string]any{"nonce": "other"}, 0},
		{"no subject", map[string]any{"sub": nil}, 0},
		{"token endpoint fails", nil, http.StatusBadGateway},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, f, st := googleService(t)
			f.claims, f.status = c.claims, c.status
			cookie, q := startGoogle(t, s, f)
			rec := callbackGoogle(s, cookie, "code=abc&state="+q.Get("state"))
			if rec.Code != http.StatusFound || !strings.HasPrefix(rec.Header().Get("Location"), "/?google=") || sessionCookie(rec) != nil {
				t.Fatalf("got %d %q session=%v", rec.Code, rec.Header().Get("Location"), sessionCookie(rec) != nil)
			}
			if _, err := st.UserByLogin("ala@example.org"); err == nil {
				t.Fatal("an account was created")
			}
		})
	}
}

func TestGoogleChecksTheStateAndUsesItOnce(t *testing.T) {
	s, f, _ := googleService(t)
	cookie, q := startGoogle(t, s, f)
	state := q.Get("state")
	for name, rec := range map[string]*httptest.ResponseRecorder{
		"no cookie":    callbackGoogle(s, nil, "code=abc&state="+state),
		"other cookie": callbackGoogle(s, &http.Cookie{Name: googleCookie, Value: "x"}, "code=abc&state="+state),
		"other state":  callbackGoogle(s, &http.Cookie{Name: googleCookie, Value: "x"}, "code=abc&state=x"),
		"no state":     callbackGoogle(s, cookie, "code=abc"),
	} {
		if sessionCookie(rec) != nil || !strings.HasPrefix(rec.Header().Get("Location"), "/?google=") {
			t.Fatalf("%s: %d %q", name, rec.Code, rec.Header().Get("Location"))
		}
	}
	if rec := callbackGoogle(s, cookie, "code=abc&state="+state); sessionCookie(rec) == nil {
		t.Fatal("the real callback was refused")
	}
	if rec := callbackGoogle(s, cookie, "code=abc&state="+state); sessionCookie(rec) != nil {
		t.Fatal("the state worked twice")
	}
}

func TestGoogleDeniedByThePerson(t *testing.T) {
	s, f, _ := googleService(t)
	cookie, q := startGoogle(t, s, f)
	rec := callbackGoogle(s, cookie, "error=access_denied&state="+q.Get("state"))
	if rec.Header().Get("Location") != "/?google=denied" {
		t.Fatalf("got %q", rec.Header().Get("Location"))
	}
}

func TestGoogleOffWhenNotConfigured(t *testing.T) {
	st, _ := store.Open(filepath.Join(t.TempDir(), "t.db"))
	defer st.Close()
	s := New(st)
	if s.GoogleEnabled() {
		t.Fatal("enabled without configuration")
	}
	rec := httptest.NewRecorder()
	s.GoogleStart(rec, httptest.NewRequest("GET", "/api/auth/google/start", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("start: %d", rec.Code)
	}
	if rec := callbackGoogle(s, nil, "code=a&state=b"); rec.Code != http.StatusNotFound {
		t.Fatalf("callback: %d", rec.Code)
	}
}

func TestGoogleRedirectFromTheRequestWithoutPublicURL(t *testing.T) {
	s, f, _ := googleService(t)
	s.Google.PublicURL = ""
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "http://ink.example/api/auth/google/start", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	s.GoogleStart(rec, req)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if got := loc.Query().Get("redirect_uri"); got != "https://ink.example/api/auth/google/callback" {
		t.Fatalf("redirect_uri %q", got)
	}
	_ = f
}
