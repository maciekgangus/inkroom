package logx

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/metrics"
)

// syncBuf is a buffer safe to write from handler goroutines.
type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }
func (s *syncBuf) String() string              { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

// lines parses the JSON log lines written so far.
func lines(t *testing.T, s *syncBuf) []map[string]any {
	t.Helper()
	var out []map[string]any
	sc := bufio.NewScanner(strings.NewReader(s.String()))
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("not JSON: %q", sc.Text())
		}
		out = append(out, m)
	}
	return out
}

func setup(t *testing.T, level slog.Level) *syncBuf {
	t.Helper()
	buf := &syncBuf{}
	Use(buf, "app", level, true)
	t.Cleanup(func() { Use(discard{}, "app", slog.LevelError, true) })
	return buf
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

func TestRecordsCarryTheContractFields(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	slog.Info("hello", "k", "v")
	ls := lines(t, buf)
	if len(ls) != 1 {
		t.Fatalf("lines = %d", len(ls))
	}
	l := ls[0]
	for _, k := range []string{"time", "level", "msg", "service"} {
		if _, ok := l[k]; !ok {
			t.Errorf("missing field %q in %v", k, l)
		}
	}
	if l["level"] != "INFO" || l["service"] != "app" || l["msg"] != "hello" || l["k"] != "v" {
		t.Errorf("unexpected record %v", l)
	}
	if _, err := time.Parse(time.RFC3339Nano, l["time"].(string)); err != nil {
		t.Errorf("time is not RFC3339: %v", l["time"])
	}
}

func TestForGivesAnotherServiceName(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	For("client").Warn("boom")
	if l := lines(t, buf)[0]; l["service"] != "client" || l["level"] != "WARN" {
		t.Errorf("record %v", l)
	}
}

func TestLevelFromEnvironmentAndTextFormat(t *testing.T) {
	var buf bytes.Buffer
	getenv := func(k string) string { return map[string]string{"LOG_LEVEL": "debug", "LOG_FORMAT": "text"}[k] }
	setupFrom(&buf, "app", getenv)
	t.Cleanup(func() { Use(discard{}, "app", slog.LevelError, true) })
	slog.Debug("visible")
	if !strings.Contains(buf.String(), "msg=visible") || !strings.Contains(buf.String(), "service=app") {
		t.Errorf("text output = %q", buf.String())
	}
}

func serve(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func mux() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/boards/{id}", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("fine"))
	})
	m.HandleFunc("GET /api/boom", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal", 500)
	})
	m.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", 401) })
	m.HandleFunc("GET /api/slow", func(w http.ResponseWriter, r *http.Request) { time.Sleep(15 * time.Millisecond) })
	m.HandleFunc("GET /api/panic", func(w http.ResponseWriter, r *http.Request) { panic("kaboom") })
	m.HandleFunc("GET /api/bad", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "bad", 400) })
	m.HandleFunc("GET /ws/{id}", func(w http.ResponseWriter, r *http.Request) { time.Sleep(15 * time.Millisecond) })
	m.Handle("/", http.NotFoundHandler())
	return m
}

func TestServerErrorsAreLoggedAtErrorWithTheRoutePatternOnly(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	h := Middleware(mux(), Options{})
	req := httptest.NewRequest("GET", "/api/boom?token=secret123&email=a@b.c", nil)
	req.Header.Set("Cookie", "session=topsecret")
	req.Header.Set("Authorization", "Bearer abc")
	serve(h, req)
	ls := lines(t, buf)
	if len(ls) != 1 {
		t.Fatalf("lines = %v", ls)
	}
	l := ls[0]
	if l["level"] != "ERROR" || l["msg"] != "request" || l["method"] != "GET" || l["path"] != "/api/boom" || l["status"] != float64(500) {
		t.Errorf("record %v", l)
	}
	for _, k := range []string{"duration_ms", "bytes", "request_id"} {
		if _, ok := l[k]; !ok {
			t.Errorf("missing %q in %v", k, l)
		}
	}
	for _, secret := range []string{"secret123", "a@b.c", "topsecret", "Bearer"} {
		if strings.Contains(buf.String(), secret) {
			t.Errorf("log leaks %q: %s", secret, buf.String())
		}
	}
}

func TestPathIsThePatternNotTheRawURL(t *testing.T) {
	buf := setup(t, slog.LevelDebug)
	serve(Middleware(mux(), Options{}), httptest.NewRequest("GET", "/api/boards/abc123SECRETid", nil))
	l := lines(t, buf)[0]
	if l["path"] != "/api/boards/{id}" || l["level"] != "DEBUG" {
		t.Errorf("record %v", l)
	}
	if strings.Contains(buf.String(), "abc123SECRETid") {
		t.Errorf("board id leaked: %s", buf.String())
	}
}

func TestClientErrorsAreWarnings(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	serve(Middleware(mux(), Options{}), httptest.NewRequest("GET", "/api/bad", nil))
	if l := lines(t, buf)[0]; l["level"] != "WARN" || l["status"] != float64(400) {
		t.Errorf("record %v", l)
	}
}

func TestNoiseIsNotLogged(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	h := Middleware(mux(), Options{})
	serve(h, httptest.NewRequest("GET", "/api/me", nil))      // a guest asking who they are: 401 all day
	serve(h, httptest.NewRequest("GET", "/favicon.ico", nil)) // an unknown static file: 404
	serve(h, httptest.NewRequest("GET", "/api/boards/x", nil))
	if got := buf.String(); got != "" {
		t.Errorf("expected no lines at info level, got %s", got)
	}
}

func TestSlowRequestsWarnButWebSocketSessionsDoNot(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	h := Middleware(mux(), Options{SlowAfter: 5 * time.Millisecond})
	serve(h, httptest.NewRequest("GET", "/api/slow", nil))
	serve(h, httptest.NewRequest("GET", "/ws/xyz", nil))
	ls := lines(t, buf)
	if len(ls) != 1 || ls[0]["level"] != "WARN" || ls[0]["path"] != "/api/slow" || ls[0]["slow"] != true {
		t.Fatalf("lines = %v", ls)
	}
}

func TestRequestIDIsGeneratedAcceptedAndEchoed(t *testing.T) {
	setup(t, slog.LevelInfo)
	h := Middleware(mux(), Options{})
	rec := serve(h, httptest.NewRequest("GET", "/api/boards/x", nil))
	if id := rec.Header().Get("X-Request-Id"); len(id) < 8 {
		t.Errorf("generated id = %q", id)
	}
	req := httptest.NewRequest("GET", "/api/boards/x", nil)
	req.Header.Set("X-Request-Id", "abc-123_DEF")
	if got := serve(h, req).Header().Get("X-Request-Id"); got != "abc-123_DEF" {
		t.Errorf("accepted id = %q", got)
	}
	req = httptest.NewRequest("GET", "/api/boards/x", nil)
	req.Header.Set("Cf-Ray", "8f1c2a3b4c5d6e7f-WAW")
	if got := serve(h, req).Header().Get("X-Request-Id"); got != "8f1c2a3b4c5d6e7f-WAW" {
		t.Errorf("cf-ray id = %q", got)
	}
	req = httptest.NewRequest("GET", "/api/boards/x", nil)
	req.Header.Set("X-Request-Id", "bad id with spaces\n\"quote")
	if got := serve(h, req).Header().Get("X-Request-Id"); strings.ContainsAny(got, " \n\"") || got == "" {
		t.Errorf("unsafe id passed through: %q", got)
	}
}

func TestRequestIDIsInTheContextLogger(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	m := http.NewServeMux()
	m.HandleFunc("GET /x", func(w http.ResponseWriter, r *http.Request) {
		From(r.Context()).Info("inside")
		http.Error(w, "x", 500)
	})
	rec := serve(Middleware(m, Options{}), httptest.NewRequest("GET", "/x", nil))
	ls := lines(t, buf)
	if ls[0]["msg"] != "inside" || ls[0]["request_id"] != rec.Header().Get("X-Request-Id") {
		t.Errorf("record %v, header %q", ls[0], rec.Header().Get("X-Request-Id"))
	}
}

func TestPanicIsRecoveredLoggedWithStackAndCounted(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	before := metrics.Panics.Value()
	rec := serve(Middleware(mux(), Options{}), httptest.NewRequest("GET", "/api/panic", nil))
	if rec.Code != 500 {
		t.Errorf("status = %d", rec.Code)
	}
	ls := lines(t, buf)
	if len(ls) != 1 {
		t.Fatalf("expected one line (the panic, not also the access line): %v", ls)
	}
	l := ls[0]
	if l["level"] != "ERROR" || l["msg"] != "panic" || l["path"] != "/api/panic" || !strings.Contains(l["stack"].(string), "goroutine") || !strings.Contains(l["panic"].(string), "kaboom") {
		t.Errorf("record %v", l)
	}
	if metrics.Panics.Value() != before+1 {
		t.Errorf("panics counter = %d, want %d", metrics.Panics.Value(), before+1)
	}
}

func TestAbortHandlerPanicIsPassedOn(t *testing.T) {
	setup(t, slog.LevelInfo)
	m := http.NewServeMux()
	m.HandleFunc("GET /x", func(w http.ResponseWriter, r *http.Request) { panic(http.ErrAbortHandler) })
	defer func() {
		if r := recover(); r != http.ErrAbortHandler {
			t.Errorf("recovered %v, want ErrAbortHandler", r)
		}
	}()
	serve(Middleware(m, Options{}), httptest.NewRequest("GET", "/x", nil))
}

func TestRecoverHelperLogsAndKeepsTheProcessAlive(t *testing.T) {
	buf := setup(t, slog.LevelInfo)
	before := metrics.Panics.Value()
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer Recover("ws-writer")
		panic(errors.New("goroutine blew up"))
	}()
	<-done
	l := lines(t, buf)[0]
	if l["level"] != "ERROR" || l["msg"] != "panic" || l["where"] != "ws-writer" || !strings.Contains(l["stack"].(string), "goroutine") {
		t.Errorf("record %v", l)
	}
	if metrics.Panics.Value() != before+1 {
		t.Errorf("panics counter did not move")
	}
}

func TestRequestsAreCountedInMetrics(t *testing.T) {
	setup(t, slog.LevelInfo)
	c := metrics.HTTPRequests.With("/api/bad", "GET", "400")
	before := c.Value()
	serve(Middleware(mux(), Options{}), httptest.NewRequest("GET", "/api/bad", nil))
	if c.Value() != before+1 {
		t.Errorf("requests counter did not move")
	}
}

// hijackRecorder is a ResponseWriter that can be hijacked, as a real server's is.
type hijackRecorder struct {
	*httptest.ResponseRecorder
	hijacked bool
}

func (h *hijackRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h.hijacked = true
	return nil, nil, nil
}

func TestWrappedWriterStillHijacksForWebSockets(t *testing.T) {
	setup(t, slog.LevelInfo)
	hr := &hijackRecorder{ResponseRecorder: httptest.NewRecorder()}
	m := http.NewServeMux()
	m.HandleFunc("GET /ws/{id}", func(w http.ResponseWriter, r *http.Request) {
		if _, _, err := http.NewResponseController(w).Hijack(); err != nil {
			t.Errorf("hijack through the wrapper failed: %v", err)
		}
	})
	Middleware(m, Options{}).ServeHTTP(hr, httptest.NewRequest("GET", "/ws/x", nil))
	if !hr.hijacked {
		t.Error("the wrapper did not pass Hijack on")
	}
}
