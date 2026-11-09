package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

func TestPasswordHashing(t *testing.T) {
	h, err := HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$") {
		t.Fatalf("unexpected format %q", h)
	}
	if !VerifyPassword(h, "correct horse") {
		t.Fatal("right password rejected")
	}
	if VerifyPassword(h, "wrong horse") {
		t.Fatal("wrong password accepted")
	}
	h2, _ := HashPassword("correct horse")
	if h == h2 {
		t.Fatal("salt should differ between hashes")
	}
	for _, bad := range []string{"", "plain", "$argon2id$garbage", "$argon2id$v=19$m=1,t=1,p=1$!!$!!"} {
		if VerifyPassword(bad, "x") {
			t.Fatalf("malformed hash %q accepted", bad)
		}
	}
}

type env struct {
	svc *Service
	st  *store.Store
	now time.Time
}

func setup(t *testing.T) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	e := &env{st: st, now: time.Now()}
	e.svc = New(st)
	e.svc.Now = func() time.Time { return e.now }
	return e
}

func (e *env) do(h http.HandlerFunc, body string, mods ...func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/x", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "192.0.2.1:1234"
	for _, m := range mods {
		m(r)
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

func withCookie(w *httptest.ResponseRecorder) func(*http.Request) {
	return func(r *http.Request) {
		for _, c := range w.Result().Cookies() {
			r.AddCookie(c)
		}
	}
}

func (e *env) me(mods ...func(*http.Request)) *httptest.ResponseRecorder {
	return e.do(e.svc.Me, "", mods...)
}

const creds = `{"email":"Ola@Example.com","password":"password1"}`

func TestRegisterLogsInAndMeReturnsTheUser(t *testing.T) {
	e := setup(t)
	w := e.do(e.svc.Register, creds)
	if w.Code != http.StatusCreated {
		t.Fatalf("register = %d %s", w.Code, w.Body)
	}
	m := e.me(withCookie(w))
	if m.Code != 200 || !strings.Contains(m.Body.String(), `"email":"ola@example.com"`) {
		t.Fatalf("me = %d %s", m.Code, m.Body)
	}
}

func TestRegisterValidation(t *testing.T) {
	e := setup(t)
	for name, body := range map[string]string{
		"bad email":      `{"email":"nope","password":"password1"}`,
		"short password": `{"email":"a@example.com","password":"short"}`,
		"empty":          `{}`,
		"not json":       `hello`,
	} {
		if w := e.do(e.svc.Register, body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d", name, w.Code)
		}
	}
	w := e.do(e.svc.Register, creds, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") })
	if w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("content type: got %d", w.Code)
	}
}

func TestDuplicateEmailIsRejectedCaseInsensitively(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	w := e.do(e.svc.Register, `{"email":"OLA@example.com","password":"password2"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("got %d", w.Code)
	}
}

func TestLogin(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	ok := e.do(e.svc.Login, `{"email":"ola@example.com","password":"password1"}`)
	if ok.Code != 200 || e.me(withCookie(ok)).Code != 200 {
		t.Fatalf("login = %d", ok.Code)
	}
	if w := e.do(e.svc.Login, `{"email":"ola@example.com","password":"wrongwrong"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("wrong password: got %d", w.Code)
	}
	if w := e.do(e.svc.Login, `{"email":"nobody@example.com","password":"password1"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("unknown email: got %d", w.Code)
	}
}

func TestMeWithoutCookieIs401(t *testing.T) {
	e := setup(t)
	if w := e.me(); w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d", w.Code)
	}
}

func TestLogoutEndsTheSession(t *testing.T) {
	e := setup(t)
	w := e.do(e.svc.Register, creds)
	out := e.do(e.svc.Logout, "", withCookie(w))
	if out.Code != http.StatusNoContent {
		t.Fatalf("logout = %d", out.Code)
	}
	if e.me(withCookie(w)).Code != http.StatusUnauthorized {
		t.Fatal("session still valid after logout")
	}
}

func TestSessionExpiresAndMeRenewsIt(t *testing.T) {
	e := setup(t)
	w := e.do(e.svc.Register, creds)
	e.now = e.now.Add(20 * 24 * time.Hour)
	if e.me(withCookie(w)).Code != 200 { // renews to now+30d
		t.Fatal("session should still be valid")
	}
	e.now = e.now.Add(20 * 24 * time.Hour) // 40 days after login, 20 after renewal
	if e.me(withCookie(w)).Code != 200 {
		t.Fatal("renewed session should still be valid")
	}
	e.now = e.now.Add(31 * 24 * time.Hour)
	if e.me(withCookie(w)).Code != http.StatusUnauthorized {
		t.Fatal("session should have expired")
	}
}

func TestCookieFlags(t *testing.T) {
	e := setup(t)
	c := e.do(e.svc.Register, creds).Result().Cookies()[0]
	if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Secure || c.Path != "/" {
		t.Fatalf("plain http cookie: %+v", c)
	}
	e2 := setup(t)
	w := e2.do(e2.svc.Register, creds, func(r *http.Request) { r.Header.Set("X-Forwarded-Proto", "https") })
	if !w.Result().Cookies()[0].Secure {
		t.Fatal("cookie should be Secure behind https")
	}
}

func TestOnlyTheTokenHashIsStored(t *testing.T) {
	e := setup(t)
	c := e.do(e.svc.Register, creds).Result().Cookies()[0]
	sum := sha256.Sum256([]byte(c.Value))
	if _, err := e.st.SessionUser(hex.EncodeToString(sum[:]), e.now); err != nil {
		t.Fatalf("hash lookup: %v", err)
	}
	if _, err := e.st.SessionUser(c.Value, e.now); err == nil {
		t.Fatal("raw token must not be a valid key")
	}
}

func TestTooManyFailedLoginsAreBlocked(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	bad := `{"email":"ola@example.com","password":"wrongwrong"}`
	for i := 0; i < 10; i++ {
		if w := e.do(e.svc.Login, bad); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, w.Code)
		}
	}
	// Even the right password is refused while blocked...
	if w := e.do(e.svc.Login, `{"email":"ola@example.com","password":"password1"}`); w.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d", w.Code)
	}
	// ...and allowed again after the window.
	e.now = e.now.Add(16 * time.Minute)
	if w := e.do(e.svc.Login, `{"email":"ola@example.com","password":"password1"}`); w.Code != 200 {
		t.Fatalf("after window: %d", w.Code)
	}
}

func TestUserFromRequest(t *testing.T) {
	e := setup(t)
	w := e.do(e.svc.Register, creds)
	r := httptest.NewRequest("GET", "/", nil)
	withCookie(w)(r)
	u, ok := e.svc.User(r)
	if !ok || u.Email != "ola@example.com" {
		t.Fatalf("got %+v %v", u, ok)
	}
	if _, ok := e.svc.User(httptest.NewRequest("GET", "/", nil)); ok {
		t.Fatal("no cookie should mean no user")
	}
}
