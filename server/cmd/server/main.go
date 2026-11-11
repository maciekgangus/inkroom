// Command server runs the Inkroom HTTP server.
package main

import (
	"context"
	"errors"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func init() {
	// Go does not know the web app manifest's type; without it the file is served as plain text.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

func main() {
	dataDir := getenv("DATA_DIR", "./data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dataDir, "inkroom.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	a := newApp(getenv("STATIC_DIR", "../web/dist"), st)
	a.configureCaptcha(os.Getenv("TURNSTILE_SITE_KEY"), os.Getenv("TURNSTILE_SECRET"))
	if os.Getenv("TURNSTILE_SECRET") == "" {
		log.Print("TURNSTILE_SECRET is not set: registration is closed")
	}
	seedDevUser(a)
	srv := &http.Server{Addr: ":" + getenv("PORT", "8080"), Handler: a.Handler()}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	log.Printf("listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	a.Close() // save pending board changes before the store closes
	log.Print("stopped")
}

// seedDevUser creates the account named by SEED_USER_EMAIL and SEED_USER_PASSWORD, if both
// are set. It is meant for local development only: production must not set them.
func seedDevUser(a *app) {
	email, password := os.Getenv("SEED_USER_EMAIL"), os.Getenv("SEED_USER_PASSWORD")
	if email == "" && password == "" {
		return
	}
	if err := a.auth.Seed(email, password); err != nil {
		log.Printf("seeding the dev user failed: %v", err)
		return
	}
	log.Printf("dev user %s is available (seeded from SEED_USER_EMAIL)", email)
}
