// Command server runs the Inkroom HTTP server.
package main

import (
	"context"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/metrics"
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

// fatal logs the error and stops the process (slog has no Fatal of its own).
func fatal(msg string, err error) {
	slog.Error(msg, "err", err)
	os.Exit(1)
}

func main() {
	logx.Setup("app") // JSON lines on stdout, LOG_LEVEL and LOG_FORMAT from the environment (ADR 0022)
	dataDir := getenv("DATA_DIR", "./data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		fatal("creating the data directory", err)
	}
	st, err := store.Open(filepath.Join(dataDir, "inkroom.db"))
	if err != nil {
		fatal("opening the database", err)
	}
	defer st.Close()

	a := newApp(getenv("STATIC_DIR", "../web/dist"), st)
	a.configureCaptcha(os.Getenv("TURNSTILE_SITE_KEY"), os.Getenv("TURNSTILE_SECRET"))
	if os.Getenv("TURNSTILE_SECRET") == "" {
		slog.Warn("TURNSTILE_SECRET is not set: registration is closed")
	}
	a.configureGoogle(os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("GOOGLE_CLIENT_SECRET"), os.Getenv("PUBLIC_URL"))
	if !a.auth.GoogleEnabled() {
		slog.Warn("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set: signing in with Google is off")
	}
	a.configureLegal(os.Getenv("OPERATOR_NAME"), os.Getenv("CONTACT_EMAIL"))
	a.configureAdmin(os.Getenv("CF_ACCESS_TEAM_DOMAIN"), os.Getenv("CF_ACCESS_AUD"))
	if a.admin == nil {
		slog.Warn("CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD is not set: the admin page is off")
	}
	if os.Getenv("ADMIN_DEV_OPEN") == "1" {
		if a.admin != nil {
			slog.Warn("ADMIN_DEV_OPEN is ignored: Cloudflare Access is configured")
		} else {
			a.configureAdminDev(true)
			slog.Warn("ADMIN_DEV_OPEN: the admin page is open to direct requests (development only)")
		}
	}
	seedDevUser(a)
	srv := &http.Server{Addr: ":" + getenv("PORT", "8080"), Handler: a.Handler()}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	metricsSrv := startMetrics()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
		if metricsSrv != nil {
			_ = metricsSrv.Shutdown(shutdown)
		}
	}()

	slog.Info("listening", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fatal("serving", err)
	}
	a.Close() // save pending board changes before the store closes
	slog.Info("stopped")
}

// startMetrics serves /metrics (Prometheus text format) on METRICS_ADDR, a listener of its own:
// never the public port and never behind the tunnel, only reachable on the machine or the
// compose network (ADR 0022). Default :9100; set it empty to turn the endpoint off. A port that
// is taken is a warning, not a reason to stop the app.
func startMetrics() *http.Server {
	addr, set := os.LookupEnv("METRICS_ADDR")
	if !set {
		addr = ":9100"
	}
	if addr == "" {
		slog.Info("METRICS_ADDR is empty: /metrics is off")
		return nil
	}
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", metrics.Default.Handler())
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		defer logx.Recover("metrics-server")
		slog.Info("serving metrics", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Warn("the metrics endpoint could not start", "addr", addr, "err", err)
		}
	}()
	return srv
}

// seedDevUser creates the account named by SEED_USER_EMAIL and SEED_USER_PASSWORD, if both
// are set. It is meant for local development only: production must not set them.
func seedDevUser(a *app) {
	email, password := os.Getenv("SEED_USER_EMAIL"), os.Getenv("SEED_USER_PASSWORD")
	if email == "" && password == "" {
		return
	}
	if err := a.auth.Seed(email, password); err != nil {
		slog.Error("seeding the dev user failed", "err", err)
		return
	}
	slog.Info("a dev user is available (seeded from SEED_USER_EMAIL)")
}
