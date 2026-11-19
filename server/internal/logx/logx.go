// Package logx is the logging every Inkroom service shares (ADR 0022): JSON lines on stdout with
// the fields time, level, msg and service, a request id on every request, panic recovery and
// an HTTP middleware that writes the access log and feeds the metrics. The app and, later, the
// other services (the recorder) call Setup once and wrap their handlers in Middleware.
package logx

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync/atomic"
)

type handlerBox struct{ h slog.Handler }

var base atomic.Pointer[handlerBox]

// Setup configures the default logger for the service from the environment: LOG_LEVEL (debug,
// info, warn or error; default info) and LOG_FORMAT (text for local development; default JSON).
// It also routes the standard library's log package through the same handler.
func Setup(service string) *slog.Logger { return setupFrom(os.Stdout, service, os.Getenv) }

func setupFrom(w io.Writer, service string, getenv func(string) string) *slog.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(strings.TrimSpace(getenv("LOG_LEVEL"))) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	return Use(w, service, level, !strings.EqualFold(getenv("LOG_FORMAT"), "text"))
}

// Use writes the logs of the service to w at the given level and makes them the default
// (tests call it to capture the output).
func Use(w io.Writer, service string, level slog.Level, json bool) *slog.Logger {
	opts := &slog.HandlerOptions{Level: level}
	var h slog.Handler
	if json {
		h = slog.NewJSONHandler(w, opts)
	} else {
		h = slog.NewTextHandler(w, opts)
	}
	base.Store(&handlerBox{h})
	l := slog.New(h).With("service", service)
	slog.SetDefault(l)
	return l
}

// For returns a logger writing to the same place under another service name (the app logs the
// errors browsers report as service "client").
func For(service string) *slog.Logger {
	b := base.Load()
	if b == nil {
		Setup("app") // main sets this up first; this is only for code that runs without it
		b = base.Load()
	}
	return slog.New(b.h).With("service", service)
}

type ctxKey struct{}

// From returns the default logger with the id of the request in ctx, if there is one.
func From(ctx context.Context) *slog.Logger {
	if id, ok := ctx.Value(ctxKey{}).(string); ok {
		return slog.Default().With("request_id", id)
	}
	return slog.Default()
}

// validID accepts what Cloudflare and proxies send as ids (letters, digits, - and _, up to 64).
func validID(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Ref is a short stable stand-in for a secret id (a board id is the secret of its link): the
// first eight hex digits of its hash. Logs carry it instead of the id, and it still lets
// several lines about one board be matched.
func Ref(id string) string {
	sum := sha256.Sum256([]byte(id))
	return hex.EncodeToString(sum[:4])
}
