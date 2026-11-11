package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Captcha checks the token a person's browser got from the captcha widget (R-054).
type Captcha interface {
	// Verify returns nil only when the token proves a human solved the challenge; ip is the
	// caller's address, which the provider may use.
	Verify(ctx context.Context, token, ip string) error
}

// TurnstileURL is where Cloudflare Turnstile tokens are checked.
const TurnstileURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// Turnstile verifies tokens with Cloudflare Turnstile (ADR 0013).
type Turnstile struct {
	Secret string
	// URL and Client are replaced in tests; the defaults are TurnstileURL and a client with a
	// short timeout.
	URL    string
	Client *http.Client
}

// Verify asks Cloudflare whether the token is valid. A network problem counts as a failure, so
// an outage closes registration rather than opening it.
func (t Turnstile) Verify(ctx context.Context, token, ip string) error {
	if strings.TrimSpace(token) == "" {
		return errors.New("no captcha token")
	}
	endpoint, client := t.URL, t.Client
	if endpoint == "" {
		endpoint = TurnstileURL
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	form := url.Values{"secret": {t.Secret}, "response": {token}}
	if ip != "" {
		form.Set("remoteip", ip)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var out struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 1<<16)).Decode(&out); err != nil {
		return err
	}
	if !out.Success {
		return errors.New("captcha rejected")
	}
	return nil
}
