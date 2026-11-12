package cfaccess

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	team = "team.cloudflareaccess.com"
	aud  = "aud-tag-123"
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// sign makes a token over header and claims with key, as Cloudflare would.
func sign(t *testing.T, key *rsa.PrivateKey, header, claims map[string]any) string {
	t.Helper()
	h, _ := json.Marshal(header)
	c, _ := json.Marshal(claims)
	in := b64(h) + "." + b64(c)
	sum := sha256.Sum256([]byte(in))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatal(err)
	}
	return in + "." + b64(sig)
}

type fixture struct {
	v     *Verifier
	key   *rsa.PrivateKey
	other *rsa.PrivateKey
	hits  *atomic.Int32
	now   time.Time
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	hits := &atomic.Int32{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k1", "kty": "RSA", "alg": "RS256",
			"n": b64(key.N.Bytes()), "e": b64(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(srv.Close)
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	v := New(team, aud)
	v.CertsURL = srv.URL
	v.Now = func() time.Time { return now }
	return fixture{v, key, other, hits, now}
}

func (f fixture) claims(over map[string]any) map[string]any {
	c := map[string]any{
		"iss": "https://" + team, "aud": []string{aud}, "email": "me@example.com",
		"exp": f.now.Add(time.Hour).Unix(), "nbf": f.now.Add(-time.Minute).Unix(),
	}
	for k, v := range over {
		c[k] = v
	}
	return c
}

func (f fixture) token(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	return sign(t, key, map[string]any{"alg": "RS256", "kid": "k1", "typ": "JWT"}, claims)
}

func TestValidTokenGivesTheEmail(t *testing.T) {
	f := newFixture(t)
	email, err := f.v.Verify(f.token(t, f.key, f.claims(nil)))
	if err != nil || email != "me@example.com" {
		t.Fatalf("Verify = %q, %v", email, err)
	}
}

func TestAudienceAsAStringIsAccepted(t *testing.T) {
	f := newFixture(t)
	if _, err := f.v.Verify(f.token(t, f.key, f.claims(map[string]any{"aud": aud}))); err != nil {
		t.Fatal(err)
	}
}

func TestRefusedTokens(t *testing.T) {
	f := newFixture(t)
	good := f.token(t, f.key, f.claims(nil))
	parts := strings.Split(good, ".")
	forged := map[string]any{"iss": "https://" + team, "aud": []string{aud}, "email": "evil@example.com", "exp": f.now.Add(time.Hour).Unix()}
	fc, _ := json.Marshal(forged)
	cases := map[string]string{
		"empty":             "",
		"not a token":       "abc",
		"two parts":         parts[0] + "." + parts[1],
		"wrong audience":    f.token(t, f.key, f.claims(map[string]any{"aud": []string{"other"}})),
		"wrong issuer":      f.token(t, f.key, f.claims(map[string]any{"iss": "https://evil.cloudflareaccess.com"})),
		"expired":           f.token(t, f.key, f.claims(map[string]any{"exp": f.now.Add(-5 * time.Minute).Unix()})),
		"not yet valid":     f.token(t, f.key, f.claims(map[string]any{"nbf": f.now.Add(time.Hour).Unix()})),
		"no expiry":         f.token(t, f.key, func() map[string]any { c := f.claims(nil); delete(c, "exp"); return c }()),
		"another key":       f.token(t, f.other, f.claims(nil)),
		"claims changed":    parts[0] + "." + b64(fc) + "." + parts[2],
		"alg none":          sign(t, f.key, map[string]any{"alg": "none", "kid": "k1"}, f.claims(nil)),
		"alg HS256":         sign(t, f.key, map[string]any{"alg": "HS256", "kid": "k1"}, f.claims(nil)),
		"unknown key id":    sign(t, f.key, map[string]any{"alg": "RS256", "kid": "zzz"}, f.claims(nil)),
		"no email at all":   f.token(t, f.key, func() map[string]any { c := f.claims(nil); delete(c, "email"); return c }()),
		"junk signature":    parts[0] + "." + parts[1] + "." + b64([]byte("x")),
		"signature missing": parts[0] + "." + parts[1] + ".",
	}
	for name, tok := range cases {
		if email, err := f.v.Verify(tok); err == nil {
			t.Errorf("%s: accepted as %q", name, email)
		}
	}
}

func TestKeysAreFetchedOnceAndKept(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < 5; i++ {
		if _, err := f.v.Verify(f.token(t, f.key, f.claims(nil))); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.hits.Load(); n != 1 {
		t.Fatalf("keys fetched %d times, want 1", n)
	}
}

func TestAnUnknownKeyIdDoesNotHammerCloudflare(t *testing.T) {
	f := newFixture(t)
	bad := sign(t, f.key, map[string]any{"alg": "RS256", "kid": "zzz"}, f.claims(nil))
	for i := 0; i < 20; i++ {
		_, _ = f.v.Verify(bad)
	}
	if n := f.hits.Load(); n > 2 {
		t.Fatalf("keys fetched %d times for 20 bad tokens", n)
	}
}

func TestUnreachableKeysRefuseEverything(t *testing.T) {
	f := newFixture(t)
	f.v.CertsURL = "http://127.0.0.1:1"
	if _, err := f.v.Verify(f.token(t, f.key, f.claims(nil))); err == nil {
		t.Fatal("accepted without being able to get the keys")
	}
}
