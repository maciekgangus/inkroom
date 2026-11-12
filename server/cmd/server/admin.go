package main

import (
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/cfaccess"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// adminPage is the administrator's page; it is in the binary, not in the static folder, which is
// public, so it can only be got through adminOnly.
//
//go:embed admin.html
var adminPage []byte

// configureAdmin turns the admin page on (R-064): the token Cloudflare Access puts on a request is
// checked against the team domain and the application audience tag. Without both it stays off.
func (a *app) configureAdmin(team, aud string) {
	if team == "" || aud == "" {
		a.admin = nil
		return
	}
	a.admin = cfaccess.New(team, aud)
}

// configureAdminDev turns on the local development switch (ADMIN_DEV_OPEN): the admin page then
// opens without Cloudflare for a request that came straight to the server. It is ignored when
// Cloudflare Access is configured, and refused for any request that went through Cloudflare or a
// proxy, so a server that has it set by mistake still does not open the page to the world.
func (a *app) configureAdminDev(on bool) { a.adminDevOpen = on }

// cameDirect reports whether the request reached the server without Cloudflare or a proxy.
func cameDirect(r *http.Request) bool {
	for _, h := range []string{"Cf-Ray", "Cf-Connecting-Ip", "X-Forwarded-For", "X-Real-Ip", cfaccess.Header} {
		if r.Header.Get(h) != "" {
			return false
		}
	}
	return true
}

// adminOnly lets a request through when it carries a valid Cloudflare Access token. Anything else,
// and everything when the page is not configured, gets the answer of an address that does not
// exist, so nothing tells that there is a page here.
func (a *app) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case a.admin == nil && a.adminDevOpen && cameDirect(r):
			// local development: no gate
		case a.admin == nil:
			http.NotFound(w, r)
			return
		default:
			if _, err := a.admin.Verify(r.Header.Get(cfaccess.Header)); err != nil {
				http.NotFound(w, r)
				return
			}
		}
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		w.Header().Set("Cache-Control", "no-store")
		next(w, r)
	}
}

// adminChange is adminOnly for requests that change something: they must also carry a header of
// the page's own, which another site cannot add to a request without the browser asking first.
func (a *app) adminChange(next http.HandlerFunc) http.HandlerFunc {
	return a.adminOnly(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Admin-Request") == "" {
			writeError(w, http.StatusForbidden, "Brak nagłówka żądania")
			return
		}
		next(w, r)
	})
}

func (a *app) adminPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(adminPage)
}

type feedbackJSON struct {
	ID        int64  `json:"id"`
	At        string `json:"at"`
	Name      string `json:"name"`
	Account   bool   `json:"account"`
	Message   string `json:"message"`
	Page      string `json:"page"`
	Screen    string `json:"screen"`
	UserAgent string `json:"userAgent"`
	Read      bool   `json:"read"`
}

const adminFeedbackLimit = 500

func (a *app) adminListFeedback(w http.ResponseWriter, _ *http.Request) {
	all, err := a.st.ListFeedback(adminFeedbackLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
		return
	}
	out := make([]feedbackJSON, 0, len(all))
	for _, f := range all {
		out = append(out, feedbackJSON{
			ID: f.ID, At: f.At.UTC().Format(time.RFC3339), Name: f.Name, Account: f.UserID != 0,
			Message: f.Message, Page: f.Page, Screen: f.Screen, UserAgent: f.UserAgent, Read: f.Read,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *app) adminMarkFeedback(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var body struct {
		Read bool `json:"read"`
	}
	if err != nil || json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&body) != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	a.adminDone(w, a.st.SetFeedbackRead(id, body.Read))
}

func (a *app) adminDeleteFeedback(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Nieprawidłowe żądanie")
		return
	}
	a.adminDone(w, a.st.DeleteFeedback(id))
}

// adminDone answers a change: nothing to say when it went through.
func (a *app) adminDone(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "Nie ma takiej uwagi")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "Błąd serwera")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
