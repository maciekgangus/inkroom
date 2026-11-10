package main

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/auth"
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
	mux.HandleFunc("DELETE /api/boards/{id}", a.deleteBoard)
	mux.HandleFunc("POST /api/boards/{id}/images", a.uploadImage)
	mux.HandleFunc("GET /api/boards/{id}/images/{image}", a.getImage)
	mux.HandleFunc("GET /ws/{id}", a.serveWS)
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
