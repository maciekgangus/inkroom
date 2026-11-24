package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

const (
	googleAuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL = "https://oauth2.googleapis.com/token"
	googleCookie   = "google_state"
	googlePath     = "/api/auth/google"
	googleStateTTL = 10 * time.Minute
	googleMaxOpen  = 1000 // sign-ins started and not finished at once
)

// Google configures "Sign in with Google" (R-063, ADR 0018): OpenID Connect, authorization
// code flow with PKCE. The zero value of Service.Google (nil) turns it off.
type Google struct {
	ClientID     string
	ClientSecret string
	// PublicURL is the address of the site (https://inkroom.example); empty: taken from the
	// request. The redirect URI registered at Google is PublicURL + "/api/auth/google/callback".
	PublicURL string
	// AuthURL and TokenURL default to Google's endpoints; tests point them at a fake.
	AuthURL  string
	TokenURL string
	// HTTP is the client for the token endpoint; nil: one with a 10 s timeout.
	HTTP *http.Client
}

// pendingGoogle is what the server remembers between sending a person to Google and their return.
type pendingGoogle struct {
	verifier string // PKCE code verifier
	nonce    string
	expires  time.Time
}

// GoogleEnabled reports whether Google sign-in is configured.
func (s *Service) GoogleEnabled() bool {
	return s.Google != nil && s.Google.ClientID != "" && s.Google.ClientSecret != ""
}

func randomString(n int) string {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		panic(err) // the system has no randomness: nothing safe is left to do
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func (g *Google) redirectURI(r *http.Request, secure bool) string {
	base := strings.TrimRight(g.PublicURL, "/")
	if base == "" {
		scheme := "http"
		if secure {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return base + googlePath + "/callback"
}

func (g *Google) endpoint(custom, fallback string) string {
	if custom != "" {
		return custom
	}
	return fallback
}

// GoogleStart sends the person to Google. The state is bound to the browser by a cookie and to
// the server by the pending entry, which also holds the PKCE verifier and the nonce.
func (s *Service) GoogleStart(w http.ResponseWriter, r *http.Request) {
	if !s.GoogleEnabled() {
		http.NotFound(w, r)
		return
	}
	state, verifier, nonce := randomString(24), randomString(32), randomString(24)
	now := s.Now()
	s.googleMu.Lock()
	if s.googlePending == nil {
		s.googlePending = map[string]pendingGoogle{}
	}
	for k, p := range s.googlePending {
		if now.After(p.expires) {
			delete(s.googlePending, k)
		}
	}
	if len(s.googlePending) >= googleMaxOpen {
		s.googleMu.Unlock()
		fail(w, http.StatusServiceUnavailable, "Spróbuj za chwilę")
		return
	}
	s.googlePending[state] = pendingGoogle{verifier: verifier, nonce: nonce, expires: now.Add(googleStateTTL)}
	s.googleMu.Unlock()

	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"client_id":             {s.Google.ClientID},
		"redirect_uri":          {s.Google.redirectURI(r, s.isSecure(r))},
		"response_type":         {"code"},
		"scope":                 {"openid email profile"},
		"state":                 {state},
		"nonce":                 {nonce},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
		"prompt":                {"select_account"},
	}
	http.SetCookie(w, &http.Cookie{
		Name: googleCookie, Value: state, Path: googlePath, MaxAge: int(googleStateTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.isSecure(r),
	})
	http.Redirect(w, r, s.Google.endpoint(s.Google.AuthURL, googleAuthURL)+"?"+q.Encode(), http.StatusFound)
}

// GoogleCallback finishes the sign-in: it checks the state, exchanges the code, validates the
// ID token and starts a session. Every failure sends the person back to /?google=<reason>.
func (s *Service) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	if !s.GoogleEnabled() {
		http.NotFound(w, r)
		return
	}
	// The cookie is spent whatever happens.
	http.SetCookie(w, &http.Cookie{Name: googleCookie, Value: "", Path: googlePath, MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.isSecure(r)})
	back := func(reason string) { http.Redirect(w, r, "/?google="+reason, http.StatusFound) }

	state := r.URL.Query().Get("state")
	c, err := r.Cookie(googleCookie)
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		back("error")
		return
	}
	s.googleMu.Lock()
	p, ok := s.googlePending[state]
	delete(s.googlePending, state)
	s.googleMu.Unlock()
	if !ok || s.Now().After(p.expires) {
		back("error")
		return
	}
	if r.URL.Query().Get("error") != "" {
		back("denied")
		return
	}
	claims, err := s.googleExchange(r, r.URL.Query().Get("code"), p)
	if err != nil {
		back("error")
		return
	}
	u, err := s.googleUser(claims)
	if err != nil {
		back("error")
		return
	}
	s.startSession(w, r, u)
	http.Redirect(w, r, "/", http.StatusFound)
}

// googleClaims are the parts of the ID token that matter here.
type googleClaims struct {
	Iss           string          `json:"iss"`
	Aud           json.RawMessage `json:"aud"`
	Sub           string          `json:"sub"`
	Email         string          `json:"email"`
	EmailVerified json.RawMessage `json:"email_verified"`
	Nonce         string          `json:"nonce"`
	Exp           int64           `json:"exp"`
}

// googleExchange trades the code for an ID token (sent with the client secret and the PKCE
// verifier) and validates its claims. The token comes straight from Google's token endpoint over
// TLS, so its signature need not be checked (OpenID Connect Core 3.1.3.7), which saves the key set.
func (s *Service) googleExchange(r *http.Request, code string, p pendingGoogle) (googleClaims, error) {
	var claims googleClaims
	if code == "" {
		return claims, errors.New("no code")
	}
	g := s.Google
	client := g.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.PostForm(g.endpoint(g.TokenURL, googleTokenURL), url.Values{
		"code": {code}, "client_id": {g.ClientID}, "client_secret": {g.ClientSecret},
		"redirect_uri": {g.redirectURI(r, s.isSecure(r))}, "grant_type": {"authorization_code"}, "code_verifier": {p.verifier},
	})
	if err != nil {
		return claims, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return claims, errors.New("token endpoint answered " + resp.Status)
	}
	var tok struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tok); err != nil {
		return claims, err
	}
	parts := strings.Split(tok.IDToken, ".")
	if len(parts) != 3 {
		return claims, errors.New("malformed id_token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payload, &claims) != nil {
		return claims, errors.New("malformed id_token payload")
	}
	if claims.Iss != "https://accounts.google.com" && claims.Iss != "accounts.google.com" {
		return claims, errors.New("wrong issuer")
	}
	if !audienceIs(claims.Aud, g.ClientID) {
		return claims, errors.New("wrong audience")
	}
	if s.Now().Unix() >= claims.Exp {
		return claims, errors.New("expired")
	}
	if subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(p.nonce)) != 1 {
		return claims, errors.New("wrong nonce")
	}
	if claims.Sub == "" || !truthy(claims.EmailVerified) {
		return claims, errors.New("no subject or unverified e-mail")
	}
	return claims, nil
}

// audienceIs reports whether the aud claim (a string or a list of strings) is exactly id.
func audienceIs(raw json.RawMessage, id string) bool {
	var one string
	if json.Unmarshal(raw, &one) == nil {
		return one == id
	}
	var many []string
	return json.Unmarshal(raw, &many) == nil && len(many) == 1 && many[0] == id
}

// truthy reads email_verified, which Google has sent both as a boolean and as a string.
func truthy(raw json.RawMessage) bool {
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return b
	}
	var str string
	return json.Unmarshal(raw, &str) == nil && str == "true"
}

// googleUser finds the account of a Google identity: by its sub, else by its verified e-mail
// (the account is linked, ADR 0018), else a new account is made.
func (s *Service) googleUser(c googleClaims) (store.User, error) {
	if u, err := s.store.UserByGoogleSub(c.Sub); err == nil {
		return u, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return store.User{}, err
	}
	email, err := normalizeEmail(c.Email)
	if err != nil {
		return store.User{}, err
	}
	u, err := s.store.UserByEmail(email)
	if err == nil {
		if err := s.store.LinkGoogle(u.ID, c.Sub); err != nil {
			return store.User{}, err
		}
		u.Hash = ""
		return u, nil
	}
	if !errors.Is(err, store.ErrNotFound) {
		return store.User{}, err
	}
	return s.store.CreateGoogleUser(email, c.Sub)
}
