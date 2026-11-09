// Command server runs the Inkroom HTTP server.
package main

import (
	"log"
	"net/http"
	"os"
)

// newHandler returns the HTTP handler: /healthz plus static files from staticDir.
func newHandler(staticDir string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
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
