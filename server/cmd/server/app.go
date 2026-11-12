package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/auth"
	"github.com/maciekgangus/inkroom/server/internal/cfaccess"
	"github.com/maciekgangus/inkroom/server/internal/room"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// flushEvery is how often pending board changes are written to SQLite (ADR 0005).
const flushEvery = 500 * time.Millisecond

type app struct {
	st        *store.Store
	auth      *auth.Service
	hub       *room.Hub
	staticDir string
	// turnstileSiteKey is the public key of the registration captcha, given to the client.
	turnstileSiteKey string
	// admin checks the Cloudflare Access token of the admin page (R-064); nil: the page is off.
	admin *cfaccess.Verifier
}

// newApp wires the services together. Call Close before closing the store.
func newApp(staticDir string, st *store.Store) *app {
	return &app{
		st:        st,
		auth:      auth.New(st),
		hub:       room.NewHub(st, flushEvery),
		staticDir: staticDir,
	}
}

// configureCaptcha turns on the Cloudflare Turnstile check for registration (R-054, ADR 0013).
// Without a secret the check stays off and registration is refused.
func (a *app) configureCaptcha(siteKey, secret string) {
	a.turnstileSiteKey = siteKey
	if secret == "" {
		a.auth.Captcha = nil
		return
	}
	a.auth.Captcha = auth.Turnstile{Secret: secret}
}

// Close saves pending board changes and disconnects everyone.
func (a *app) Close() { a.hub.Close() }

// Handler returns the HTTP handler: health check, accounts, boards, board WebSocket and
// static files (index.html also serves /b/<id>, the client route).
func (a *app) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /api/register", a.auth.Register)
	mux.HandleFunc("POST /api/login", a.auth.Login)
	mux.HandleFunc("POST /api/logout", a.auth.Logout)
	mux.HandleFunc("GET /api/me", a.auth.Me)
	mux.HandleFunc("POST /api/boards", a.createBoard)
	mux.HandleFunc("GET /api/boards", a.listBoards)
	mux.HandleFunc("GET /api/boards/{id}", a.getBoard)
	mux.HandleFunc("PATCH /api/boards/{id}", a.renameBoard)
	mux.HandleFunc("PUT /api/boards/{id}/background", a.setBackground)
	mux.HandleFunc("GET /api/boards/{id}/view", a.getView)
	mux.HandleFunc("PUT /api/boards/{id}/view", a.setView)
	mux.HandleFunc("POST /api/boards/{id}/copy", a.copyBoard)
	mux.HandleFunc("DELETE /api/boards/{id}/visit", a.forgetBoard)
	mux.HandleFunc("GET /api/boards/{id}/preview", a.boardPreview)
	mux.HandleFunc("DELETE /api/boards/{id}", a.deleteBoard)
	mux.HandleFunc("POST /api/boards/{id}/images", a.uploadImage)
	mux.HandleFunc("GET /api/boards/{id}/images/{image}", a.getImage)
	mux.HandleFunc("POST /api/feedback", a.sendFeedback)
	mux.HandleFunc("GET /admin", a.adminOnly(a.adminPage))
	mux.HandleFunc("GET /api/admin/feedback", a.adminOnly(a.adminListFeedback))
	mux.HandleFunc("POST /api/admin/feedback/{id}/read", a.adminChange(a.adminMarkFeedback))
	mux.HandleFunc("DELETE /api/admin/feedback/{id}", a.adminChange(a.adminDeleteFeedback))
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"turnstileSiteKey": a.turnstileSiteKey})
	})
	mux.HandleFunc("GET /ws/{id}", a.serveWS)
	mux.HandleFunc("GET /register", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(a.staticDir, "index.html"))
	})
	mux.HandleFunc("GET /b/{id}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(a.staticDir, "index.html"))
	})
	mux.Handle("/", http.FileServer(http.Dir(a.staticDir)))
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
