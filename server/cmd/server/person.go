package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// guestCookie names the cookie that tells the server which guest is calling (ADR 0011).
const guestCookie = "inkroom_guest"

// guestCookieAge is how long a guest is remembered: about a year.
const guestCookieAge = 365 * 24 * time.Hour

// ensureGuestCookie gives a caller without a guest cookie a new random secret. The cookie is
// HttpOnly, so scripts on the page never see it, and the person is derived from it by hashing,
// so what other people learn about them (their author id) does not reveal it.
func (a *app) ensureGuestCookie(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(guestCookie); err == nil && len(c.Value) == 64 {
		return
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     guestCookie,
		Value:    hex.EncodeToString(secret),
		Path:     "/",
		MaxAge:   int(guestCookieAge / time.Second),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
	})
}

// person says who is behind a request: an account, a guest known by cookie, or (without a
// cookie, e.g. a script) just the author id it gave.
func (a *app) person(r *http.Request, u store.User, loggedIn bool, authorID string) string {
	if loggedIn {
		return "u:" + strconv.FormatInt(u.ID, 10)
	}
	if c, err := r.Cookie(guestCookie); err == nil && len(c.Value) == 64 {
		sum := sha256.Sum256([]byte(c.Value))
		return "g:" + hex.EncodeToString(sum[:16])
	}
	return "a:" + authorID
}
