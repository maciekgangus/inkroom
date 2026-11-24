package main

import "net/http"

// contentSecurityPolicy is the app's CSP (security audit 2026-11): only own scripts, plus the
// Cloudflare Turnstile captcha hosts its widget needs. style-src keeps 'unsafe-inline' because
// the UI sets inline style attributes; script-src stays strict. The admin page (adminOnly)
// overrides it, as its page is embedded in the binary and uses one inline script.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' https://challenges.cloudflare.com; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self'; " +
	"connect-src 'self' ws: wss: https://challenges.cloudflare.com; " +
	"frame-src https://challenges.cloudflare.com; " +
	"worker-src 'self' blob:; " +
	"object-src 'none'; base-uri 'self'; form-action 'self'"

// secureHeaders adds the security headers every response should carry (security audit 2026-11):
// no sniffing, no framing (the board links must not be clickjacked into an iframe), a strict
// referrer policy and the CSP above.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}
