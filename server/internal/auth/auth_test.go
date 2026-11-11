package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
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

// fakeCaptcha accepts the token "ok" and nothing else.
type fakeCaptcha struct{}

func (fakeCaptcha) Verify(_ context.Context, token, _ string) error {
	if token == "ok" {
		return nil
	}
	return errors.New("bad token")
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
	e.svc.Captcha = fakeCaptcha{}
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

const creds = `{"email":"Ola@Example.com","username":"Ola","password":"password1","captcha":"ok"}`

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
		"bad email":           `{"email":"nope","username":"nope","password":"password1","captcha":"ok"}`,
		"short password":      `{"email":"a@example.com","username":"abc","password":"short","captcha":"ok"}`,
		"no username":         `{"email":"a@example.com","password":"password1","captcha":"ok"}`,
		"short username":      `{"email":"a@example.com","username":"ab","password":"password1","captcha":"ok"}`,
		"long username":       `{"email":"a@example.com","username":"abcdefghijklmnopqrstuvwxy","password":"password1","captcha":"ok"}`,
		"bad characters":      `{"email":"a@example.com","username":"ola kowalska","password":"password1","captcha":"ok"}`,
		"polish letters":      `{"email":"a@example.com","username":"zółw","password":"password1","captcha":"ok"}`,
		"an e-mail as a name": `{"email":"a@example.com","username":"a@b.pl","password":"password1","captcha":"ok"}`,
		"no captcha":          `{"email":"a@example.com","username":"abc","password":"password1"}`,
		"wrong captcha":       `{"email":"a@example.com","username":"abc","password":"password1","captcha":"nope"}`,
		"empty":               `{}`,
		"not json":            `hello`,
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
	w := e.do(e.svc.Register, `{"email":"OLA@example.com","username":"inna","password":"password2","captcha":"ok"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("got %d", w.Code)
	}
}

func TestDuplicateUsernameIsRejectedCaseInsensitively(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	w := e.do(e.svc.Register, `{"email":"inna@example.com","username":"OLA","password":"password2","captcha":"ok"}`)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "nazwa użytkownika jest zajęta") {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
}

func TestRegisterIsRefusedWithoutACaptchaCheck(t *testing.T) {
	e := setup(t)
	e.svc.Captcha = nil // not configured: it must not open registration quietly
	if w := e.do(e.svc.Register, creds); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	if _, err := e.st.UserByLogin("ola"); err == nil {
		t.Fatal("an account was created without the check")
	}
}

func TestTheCaptchaIsCheckedBeforeTheAccountIsMade(t *testing.T) {
	e := setup(t)
	w := e.do(e.svc.Register, `{"email":"a@example.com","username":"abc","password":"password1","captcha":"nope"}`)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "robotem") {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	if _, err := e.st.UserByLogin("abc"); err == nil {
		t.Fatal("an account was created after a failed captcha")
	}
}

func TestMeReturnsTheUsernameAsTyped(t *testing.T) {
	e := setup(t)
	w := e.do(e.svc.Register, creds)
	m := e.me(withCookie(w))
	if !strings.Contains(m.Body.String(), `"username":"Ola"`) {
		t.Fatalf("me = %s", m.Body)
	}
}

func TestLogin(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	ok := e.do(e.svc.Login, `{"login":"ola@example.com","password":"password1"}`)
	if ok.Code != 200 || e.me(withCookie(ok)).Code != 200 {
		t.Fatalf("login = %d", ok.Code)
	}
	if w := e.do(e.svc.Login, `{"login":"ola@example.com","password":"wrongwrong"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("wrong password: got %d", w.Code)
	}
	if w := e.do(e.svc.Login, `{"login":"nobody@example.com","password":"password1"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("unknown email: got %d", w.Code)
	}
}

func TestLoginWithTheUsernameInAnyLetterCase(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	for _, name := range []string{"Ola", "ola", "OLA"} {
		w := e.do(e.svc.Login, `{"login":"`+name+`","password":"password1"}`)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"username":"Ola"`) {
			t.Fatalf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	if w := e.do(e.svc.Login, `{"login":"ola","password":"wrongwrong"}`); w.Code != http.StatusUnauthorized {
		t.Errorf("wrong password: %d", w.Code)
	}
}

func TestLoginNeverSaysWhetherTheAccountExists(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	a := e.do(e.svc.Login, `{"login":"ola","password":"wrongwrong"}`)
	b := e.do(e.svc.Login, `{"login":"nobody","password":"wrongwrong"}`)
	c := e.do(e.svc.Login, `{"login":"nobody@example.com","password":"wrongwrong"}`)
	if a.Code != b.Code || b.Code != c.Code || a.Body.String() != b.Body.String() || b.Body.String() != c.Body.String() {
		t.Fatalf("answers differ: %d %s | %d %s | %d %s", a.Code, a.Body, b.Code, b.Body, c.Code, c.Body)
	}
}

func TestFailedLoginsAreCountedPerAccountWhateverWayItIsNamed(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)
	for i := 0; i < 5; i++ {
		e.do(e.svc.Login, `{"login":"ola","password":"wrongwrong"}`)
		e.do(e.svc.Login, `{"login":"OLA@example.com","password":"wrongwrong"}`)
	}
	if w := e.do(e.svc.Login, `{"login":"Ola","password":"password1"}`, func(r *http.Request) { r.RemoteAddr = "198.51.100.9:1" }); w.Code != http.StatusTooManyRequests {
		t.Fatalf("a second way of naming the account got round the limit: %d", w.Code)
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
	bad := `{"login":"ola@example.com","password":"wrongwrong"}`
	for i := 0; i < 10; i++ {
		if w := e.do(e.svc.Login, bad); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, w.Code)
		}
	}
	// Even the right password is refused while blocked...
	if w := e.do(e.svc.Login, `{"login":"ola@example.com","password":"password1"}`); w.Code != http.StatusTooManyRequests {
		t.Fatalf("got %d", w.Code)
	}
	// ...and allowed again after the window.
	e.now = e.now.Add(16 * time.Minute)
	if w := e.do(e.svc.Login, `{"login":"ola@example.com","password":"password1"}`); w.Code != 200 {
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

func TestErrorMessagesArePolish(t *testing.T) {
	e := setup(t)
	e.do(e.svc.Register, creds)

	cases := []struct {
		name string
		w    *httptest.ResponseRecorder
		want string
	}{
		{"wrong password", e.do(e.svc.Login, `{"login":"ola@example.com","password":"wrongwrong"}`), "Nieprawidłowy login lub hasło"},
		{"duplicate", e.do(e.svc.Register, creds), "już zarejestrowany"},
		{"short password", e.do(e.svc.Register, `{"email":"b@example.com","username":"bob","password":"x","captcha":"ok"}`), "min. 8 znaków"},
		{"not logged in", e.me(), "Nie jesteś zalogowany"},
	}
	for _, c := range cases {
		if !strings.Contains(c.w.Body.String(), c.want) {
			t.Errorf("%s: body %q does not contain %q", c.name, c.w.Body.String(), c.want)
		}
	}

	bad := `{"login":"ola@example.com","password":"wrongwrong"}`
	for i := 0; i < 10; i++ {
		e.do(e.svc.Login, bad)
	}
	if w := e.do(e.svc.Login, bad); !strings.Contains(w.Body.String(), "Zbyt wiele prób") {
		t.Errorf("rate limit: body %q", w.Body.String())
	}
}

func TestSeedCreatesAUserWhoCanLogIn(t *testing.T) {
	e := setup(t)
	if err := e.svc.Seed("Dev@Example.test", "seed-password-1"); err != nil {
		t.Fatal(err)
	}
	w := e.do(e.svc.Login, `{"login":"dev@example.test","password":"seed-password-1"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("login as seeded user = %d %s", w.Code, w.Body)
	}
}

func TestSeedIsIdempotentAndKeepsTheExistingPassword(t *testing.T) {
	e := setup(t)
	if err := e.svc.Seed("dev@example.test", "first-password-1"); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.Seed("dev@example.test", "other-password-2"); err != nil {
		t.Fatalf("seeding twice should be fine: %v", err)
	}
	if w := e.do(e.svc.Login, `{"login":"dev@example.test","password":"first-password-1"}`); w.Code != http.StatusOK {
		t.Fatalf("original password should still work: %d", w.Code)
	}
	if w := e.do(e.svc.Login, `{"login":"dev@example.test","password":"other-password-2"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("second password must not replace the first: %d", w.Code)
	}
}

func TestSeedRejectsBadInput(t *testing.T) {
	e := setup(t)
	if err := e.svc.Seed("not-an-email", "long-enough-pw"); err == nil {
		t.Error("expected an error for a bad e-mail")
	}
	if err := e.svc.Seed("dev@example.test", "short"); err == nil {
		t.Error("expected an error for a short password")
	}
}
