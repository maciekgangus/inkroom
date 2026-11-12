// Package cfaccess checks the token that Cloudflare Access puts on every request it lets through
// (the Cf-Access-Jwt-Assertion header), so the server does not rely on the gate alone (R-064).
package cfaccess

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Header is the request header Cloudflare Access puts the token in.
const Header = "Cf-Access-Jwt-Assertion"

const (
	keysTTL       = time.Hour        // how long fetched keys are trusted
	refetchWindow = time.Minute      // an unknown key id may fetch the keys again at most this often
	leeway        = 30 * time.Second // allowed clock difference
)

// Verifier checks Cloudflare Access tokens of one team and one application.
type Verifier struct {
	// Team is the team domain, e.g. "myteam.cloudflareaccess.com": it is the issuer of the tokens.
	Team string
	// Aud is the application audience tag the tokens must be made for.
	Aud string
	// CertsURL is where the public keys are; by default the team's /cdn-cgi/access/certs.
	CertsURL string
	// Now is the clock; tests set it.
	Now func() time.Time

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
	client  *http.Client
}

// New makes a verifier for the team domain and application audience tag.
func New(team, aud string) *Verifier {
	return &Verifier{
		Team: team, Aud: aud,
		CertsURL: "https://" + team + "/cdn-cgi/access/certs",
		Now:      time.Now,
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}

type header struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
}

type claims struct {
	Iss   string          `json:"iss"`
	Aud   json.RawMessage `json:"aud"`
	Email string          `json:"email"`
	Exp   int64           `json:"exp"`
	Nbf   int64           `json:"nbf"`
}

// Verify checks the token (signature, issuer, audience, validity in time) and returns the e-mail
// of the person it was issued to. Anything wrong, or no way to get the keys, is an error.
func (v *Verifier) Verify(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("not a token")
	}
	var h header
	if err := decode(parts[0], &h); err != nil {
		return "", err
	}
	if h.Alg != "RS256" { // never "none", never a shared-secret algorithm
		return "", fmt.Errorf("algorithm %q not accepted", h.Alg)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) == 0 {
		return "", errors.New("bad signature")
	}
	key, err := v.key(h.Kid)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig); err != nil {
		return "", errors.New("signature does not match")
	}
	var c claims
	if err := decode(parts[1], &c); err != nil {
		return "", err
	}
	now := v.Now()
	if c.Iss != "https://"+v.Team {
		return "", errors.New("wrong issuer")
	}
	if !hasAudience(c.Aud, v.Aud) {
		return "", errors.New("wrong audience")
	}
	if c.Exp == 0 || now.After(time.Unix(c.Exp, 0).Add(leeway)) {
		return "", errors.New("expired")
	}
	if c.Nbf != 0 && now.Add(leeway).Before(time.Unix(c.Nbf, 0)) {
		return "", errors.New("not valid yet")
	}
	if c.Email == "" {
		return "", errors.New("no e-mail in the token")
	}
	return c.Email, nil
}

func decode(part string, into any) error {
	b, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, into)
}

// hasAudience reports whether the "aud" claim (a string or a list) holds want.
func hasAudience(raw json.RawMessage, want string) bool {
	var one string
	if json.Unmarshal(raw, &one) == nil {
		return one == want
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		for _, a := range many {
			if a == want {
				return true
			}
		}
	}
	return false
}

// key returns the public key with the id, fetching the keys when they are old or the id is new
// (Cloudflare rotates them); an unknown id fetches again only once in a while.
func (v *Verifier) key(kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := v.Now()
	if k, ok := v.keys[kid]; ok && now.Sub(v.fetched) < keysTTL {
		return k, nil
	}
	if v.keys != nil && now.Sub(v.fetched) < refetchWindow {
		return nil, errors.New("unknown key")
	}
	if err := v.fetch(); err != nil {
		return nil, err
	}
	k, ok := v.keys[kid]
	if !ok {
		return nil, errors.New("unknown key")
	}
	return k, nil
}

func (v *Verifier) fetch() error {
	resp, err := v.client.Get(v.CertsURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("keys: %s", resp.Status)
	}
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 1<<20)).Decode(&set); err != nil {
		return err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, errN := base64.RawURLEncoding.DecodeString(k.N)
		e, errE := base64.RawURLEncoding.DecodeString(k.E)
		if errN != nil || errE != nil {
			continue
		}
		exp := new(big.Int).SetBytes(e)
		if !exp.IsInt64() {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(exp.Int64())}
	}
	v.keys, v.fetched = keys, v.Now()
	return nil
}
