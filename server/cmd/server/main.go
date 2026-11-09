// Command server runs the Inkroom HTTP server.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/maciekgangus/inkroom/server/internal/room"
)

// newHandler returns the HTTP handler: health check, board API, board WebSocket and
// static files from staticDir (index.html also serves /b/<id>, the client route).
func newHandler(staticDir string) http.Handler {
	hub := room.NewHub()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /api/boards", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"id": hub.Create()})
	})
	mux.HandleFunc("GET /ws/{id}", serveWS(hub))
	mux.HandleFunc("GET /b/{id}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})
	mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	return mux
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	addr := ":" + getenv("PORT", "8080")
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, newHandler(getenv("STATIC_DIR", "../web/dist"))))
}
