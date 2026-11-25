package main

import (
	"net/http"
	"strings"
)

// contentSecurityPolicy is the app's CSP (security audit 2026-11): only own scripts, plus the
// Cloudflare Turnstile captcha hosts its widget needs. style-src keeps 'unsafe-inline' because
// the UI sets inline style attributes; script-src stays strict. The admin page (adminOnly)
// overrides it, as its page is embedded in the binary and uses one inline script.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' https://challenges.cloudflare.com; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self'; " +
	"media-src 'self'; " +
	"connect-src 'self' ws: wss: https://challenges.cloudflare.com; " +
	"frame-src https://challenges.cloudflare.com; " +
	"worker-src 'self' blob:; " +
	"object-src 'none'; base-uri 'self'; form-action 'self'"

// pageCSP is the CSP with the origin of the recordings bucket added to what the page may connect
// to and play from, because the browser sends the parts of a recording straight to it and plays
// the audio from it (R-094, R-114); "" adds nothing.
func pageCSP(bucketOrigin string) string {
	if bucketOrigin == "" {
		return contentSecurityPolicy
	}
	csp := strings.Replace(contentSecurityPolicy, "connect-src 'self' ", "connect-src 'self' "+bucketOrigin+" ", 1)
	// The player's <audio> reads the recording from the bucket too.
	return strings.Replace(csp, "media-src 'self'", "media-src 'self' "+bucketOrigin, 1)
}

// secureHeaders adds the security headers every response should carry (security audit 2026-11):
// no sniffing, no framing (the board links must not be clickjacked into an iframe), a strict
// referrer policy and the given CSP.
func secureHeaders(csp string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Content-Security-Policy", csp)
		next.ServeHTTP(w, r)
	})
}
