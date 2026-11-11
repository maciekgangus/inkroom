// Package auth implements e-mail and password accounts with cookie sessions (ADR 0005).
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
	"golang.org/x/crypto/argon2"
)

const (
	cookieName    = "session"
	sessionTTL    = 30 * 24 * time.Hour
	minPassword   = 8
	maxPassword   = 200
	maxEmail      = 254
	minUsername   = 3
	maxUsername   = 24
	maxBody       = 4 << 10
	loginAttempts = 10
	loginWindow   = 15 * time.Minute

	argonTime    = 2
	argonMemory  = 19 * 1024 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16
)

// HashPassword returns an argon2id hash in the usual `$argon2id$...` encoding.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword reports whether password matches hash. Malformed hashes never match.
func VerifyPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || m == 0 || t == 0 || p == 0 || m > 1<<20 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) == 0 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// Service handles registration, login, logout and the current-user lookup.
type Service struct {
	store *store.Store
	// Now is the clock; tests replace it.
	Now func() time.Time

	// Captcha checks the token sent with a registration. Without it registration is refused
	// (503): a missing configuration must not open the door (R-054, ADR 0013).
	Captcha Captcha

	failMu sync.Mutex
	fails  map[string][]time.Time

	dummyOnce sync.Once
	dummyHash string
}

// New returns a Service backed by st.
func New(st *store.Store) *Service {
	return &Service{store: st, Now: time.Now, fails: map[string][]time.Time{}}
}

type credentials struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Login    string `json:"login"` // an e-mail or a username, when logging in
	Password string `json:"password"`
	Captcha  string `json:"captcha"`
}

// Register creates an account and logs it in. The captcha is checked first, so a bot gets no
// answer about which e-mails and names are taken.
func (s *Service) Register(w http.ResponseWriter, r *http.Request) {
	c, ok := readCredentials(w, r)
	if !ok {
		return
	}
	if s.Captcha == nil {
		fail(w, http.StatusServiceUnavailable, "Rejestracja jest chwilowo niedostępna")
		return
	}
	if err := s.Captcha.Verify(r.Context(), c.Captcha, clientIP(r)); err != nil {
		fail(w, http.StatusBadRequest, "Nie udało się potwierdzić, że nie jesteś robotem. Spróbuj jeszcze raz")
		return
	}
	email, err := normalizeEmail(c.Email)
	if err != nil || len(c.Password) < minPassword || len(c.Password) > maxPassword {
		fail(w, http.StatusBadRequest, "Podaj poprawny e-mail i hasło (min. 8 znaków)")
		return
	}
	if !validUsername(c.Username) {
		fail(w, http.StatusBadRequest, "Nazwa użytkownika ma mieć od 3 do 24 znaków: litery a-z, cyfry, kropka, myślnik lub podkreślnik")
		return
	}
	hash, err := HashPassword(c.Password)
	if err != nil {
		fail(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	u, err := s.store.CreateAccount(email, c.Username, hash)
	if errors.Is(err, store.ErrEmailTaken) {
		fail(w, http.StatusConflict, "Ten e-mail jest już zarejestrowany")
		return
	}
	if errors.Is(err, store.ErrUsernameTaken) {
		fail(w, http.StatusConflict, "Ta nazwa użytkownika jest zajęta")
		return
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	s.startSession(w, r, u)
	respondUser(w, http.StatusCreated, u)
}

// validUsername reports whether name is 3 to 24 of the characters a username may have.
func validUsername(name string) bool {
	if len(name) < minUsername || len(name) > maxUsername {
		return false
	}
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

// Seed makes sure an account exists, for local development. An existing account is left
// untouched (its password is not reset). Never call it with a real user's password.
func (s *Service) Seed(email, password string) error {
	email, err := normalizeEmail(email)
	if err != nil {
		return err
	}
	if len(password) < minPassword || len(password) > maxPassword {
		return errors.New("seed password must have at least 8 characters")
	}
	if _, err := s.store.UserByEmail(email); err == nil {
		return nil
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	if _, err := s.store.CreateUser(email, hash); err != nil && !errors.Is(err, store.ErrEmailTaken) {
		return err
	}
	return nil
}

// Login checks credentials and starts a session. The login is an e-mail (it has an @) or a
// username; the answer to a failure is the same whether or not such an account exists.
func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	c, ok := readCredentials(w, r)
	if !ok {
		return
	}
	login := strings.ToLower(strings.TrimSpace(c.Login))
	if login == "" || len(login) > maxEmail {
		fail(w, http.StatusUnauthorized, "Nieprawidłowy login lub hasło")
		return
	}
	ipKey := "ip:" + clientIP(r)
	u, err := s.store.UserByLogin(login)
	// Failures are counted per account however it was named (its e-mail or its username), and
	// per name for accounts that do not exist.
	accountKey := "login:" + login
	if err == nil {
		accountKey = "account:" + strconv.FormatInt(u.ID, 10)
	}
	if s.blocked(ipKey) || s.blocked(accountKey) {
		fail(w, http.StatusTooManyRequests, "Zbyt wiele prób, spróbuj ponownie za kilkanaście minut")
		return
	}
	hash := u.Hash
	if err != nil {
		hash = s.dummy() // keep timing similar for unknown accounts
	}
	if !VerifyPassword(hash, c.Password) || err != nil {
		s.recordFail(ipKey)
		s.recordFail(accountKey)
		fail(w, http.StatusUnauthorized, "Nieprawidłowy login lub hasło")
		return
	}
	s.clearFails(accountKey)
	s.startSession(w, r, u)
	respondUser(w, http.StatusOK, u)
}

// Logout ends the current session.
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if !RequireJSON(w, r) {
		return
	}
	if c, err := r.Cookie(cookieName); err == nil {
		_ = s.store.DeleteSession(hashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isSecure(r)})
	w.WriteHeader(http.StatusNoContent)
}

// Me returns the logged-in user and renews the session.
func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		fail(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	th := hashToken(c.Value)
	u, err := s.store.SessionUser(th, s.Now())
	if err != nil {
		fail(w, http.StatusUnauthorized, "Nie jesteś zalogowany")
		return
	}
	_ = s.store.ExtendSession(th, s.Now().Add(sessionTTL))
	respondUser(w, http.StatusOK, u)
}

// User returns the logged-in user of a request, if any (does not renew the session).
func (s *Service) User(r *http.Request) (store.User, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return store.User{}, false
	}
	u, err := s.store.SessionUser(hashToken(c.Value), s.Now())
	return u, err == nil
}

func (s *Service) startSession(w http.ResponseWriter, r *http.Request, u store.User) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		fail(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	exp := s.Now().Add(sessionTTL)
	if err := s.store.CreateSession(hashToken(token), u.ID, exp); err != nil {
		fail(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isSecure(r),
	})
}

func (s *Service) dummy() string {
	s.dummyOnce.Do(func() { s.dummyHash, _ = HashPassword("dummy-password") })
	return s.dummyHash
}

func (s *Service) blocked(key string) bool {
	s.failMu.Lock()
	defer s.failMu.Unlock()
	return len(s.recentLocked(key)) >= loginAttempts
}

func (s *Service) recordFail(key string) {
	s.failMu.Lock()
	defer s.failMu.Unlock()
	s.fails[key] = append(s.recentLocked(key), s.Now())
}

func (s *Service) clearFails(key string) {
	s.failMu.Lock()
	defer s.failMu.Unlock()
	delete(s.fails, key)
}

// recentLocked returns the attempts inside the window and drops older ones.
func (s *Service) recentLocked(key string) []time.Time {
	cutoff := s.Now().Add(-loginWindow)
	var keep []time.Time
	for _, t := range s.fails[key] {
		if t.After(cutoff) {
			keep = append(keep, t)
		}
	}
	if len(keep) == 0 {
		delete(s.fails, key)
	} else {
		s.fails[key] = keep
	}
	return keep
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func normalizeEmail(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxEmail {
		return "", errors.New("invalid e-mail")
	}
	a, err := mail.ParseAddress(raw)
	if err != nil || a.Address != raw {
		return "", errors.New("invalid e-mail")
	}
	return strings.ToLower(raw), nil
}

func isSecure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// clientIP prefers the address Cloudflare reports (the app is only reachable through the tunnel).
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RequireJSON enforces Content-Type: application/json, which (with SameSite=Lax) blocks CSRF.
func RequireJSON(w http.ResponseWriter, r *http.Request) bool {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		fail(w, http.StatusUnsupportedMediaType, "Oczekiwano application/json")
		return false
	}
	return true
}

func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var c credentials
	if !RequireJSON(w, r) {
		return c, false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&c); err != nil {
		fail(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return c, false
	}
	return c, true
}

func respondUser(w http.ResponseWriter, status int, u store.User) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"email": u.Email, "username": u.Username})
}

func fail(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
