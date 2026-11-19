package logx

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/metrics"
)

// Options tunes Middleware.
type Options struct {
	// SlowAfter is the duration from which a request is logged as slow (default one second).
	SlowAfter time.Duration
}

// Middleware gives every request an id (X-Request-Id or Cloudflare's Cf-Ray when they look safe,
// else a random one; it is echoed in the response), recovers panics, counts the request in the
// metrics and writes the access log: status 500 and up at ERROR, 400 and up and slow requests
// at WARN, the rest at DEBUG. It logs the route pattern, never the URL, query, headers, cookies
// or bodies, and no address of the caller (ADR 0022, the privacy policy).
func Middleware(next http.Handler, o Options) http.Handler {
	slow := o.SlowAfter
	if slow <= 0 {
		slow = time.Second
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := r.Header.Get("X-Request-Id")
		if !validID(id) {
			id = r.Header.Get("Cf-Ray")
			if !validID(id) {
				id = newID()
			}
		}
		w.Header().Set("X-Request-Id", id)
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)) // the mux fills r.Pattern on this copy
		sw := &statusWriter{ResponseWriter: w}

		panicked := false
		func() {
			defer func() {
				v := recover()
				if v == nil {
					return
				}
				if v == http.ErrAbortHandler {
					panic(v) // the server's own way to cut a response short: not ours to swallow
				}
				panicked = true
				logPanic(v, "request", slog.String("method", r.Method), slog.String("path", route(r)), slog.String("request_id", id))
				if !sw.wrote {
					http.Error(sw, "internal error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(sw, r)
		}()

		status := sw.status
		if status == 0 {
			status = http.StatusOK
		}
		if panicked {
			status = http.StatusInternalServerError
		}
		d := time.Since(start)
		path := route(r)
		method := normMethod(r.Method)
		metrics.HTTPRequests.With(path, method, strconv.Itoa(status)).Inc()
		ws := strings.HasPrefix(r.URL.Path, "/ws/")
		if !ws {
			metrics.HTTPDuration.With(path).Observe(d.Seconds())
		}
		if panicked {
			return // the panic line says it all
		}

		level := slog.LevelDebug
		isSlow := !ws && d >= slow
		switch {
		case status >= 500:
			level = slog.LevelError
		case isSlow:
			level = slog.LevelWarn
		case status >= 400 && !noise(path, status):
			level = slog.LevelWarn
		}
		attrs := []slog.Attr{
			slog.String("method", r.Method), slog.String("path", path), slog.Int("status", status),
			slog.Float64("duration_ms", math.Round(d.Seconds()*1e4)/10), slog.Int64("bytes", sw.n),
			slog.String("request_id", id),
		}
		if isSlow {
			attrs = append(attrs, slog.Bool("slow", true))
		}
		slog.LogAttrs(r.Context(), level, "request", attrs...)
	})
}

// route is the pattern that matched ("GET /api/boards/{id}" gives "/api/boards/{id}"): it has no
// ids, tokens or query, and few distinct values, so it is safe in logs and metric labels.
func route(r *http.Request) string {
	p := r.Pattern
	if i := strings.IndexByte(p, ' '); i >= 0 {
		p = p[i+1:]
	}
	if p == "" {
		return "unmatched"
	}
	return p
}

func normMethod(m string) string {
	switch m {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		return m
	}
	return "OTHER"
}

// noise is the 4xx that happen all day and say nothing: a guest asking /api/me (401) and an unknown
// static file (404).
func noise(path string, status int) bool {
	return (status == http.StatusUnauthorized && path == "/api/me") || (status == http.StatusNotFound && path == "/")
}

// Recover is deferred at the top of a goroutine so a panic in it is logged with its stack and
// counted instead of killing the process: `defer logx.Recover("ws-writer")`.
func Recover(where string) {
	if v := recover(); v != nil {
		logPanic(v, where)
	}
}

// Panic logs a panic value that the caller has recovered itself, with the stack of the place it is
// called from (so call it inside the deferred function), and counts it.
func Panic(where string, v any) { logPanic(v, where) }

func logPanic(v any, where string, extra ...slog.Attr) {
	metrics.Panics.Inc()
	attrs := append([]slog.Attr{
		slog.String("panic", clip(fmt.Sprint(v), 500)),
		slog.String("stack", clip(string(debug.Stack()), 4000)),
	}, extra...)
	if where != "request" {
		attrs = append(attrs, slog.String("where", where))
	}
	slog.LogAttrs(context.Background(), slog.LevelError, "panic", attrs...)
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// statusWriter remembers the status and the size of the response. It passes Hijack and Flush on
// and unwraps for http.ResponseController, which the WebSocket library needs.
type statusWriter struct {
	http.ResponseWriter
	status int
	n      int64
	wrote  bool
}

func (s *statusWriter) WriteHeader(code int) {
	if !s.wrote {
		s.status, s.wrote = code, true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if !s.wrote {
		s.status, s.wrote = http.StatusOK, true
	}
	n, err := s.ResponseWriter.Write(b)
	s.n += int64(n)
	return n, err
}

func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return http.NewResponseController(s.ResponseWriter).Hijack()
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }
