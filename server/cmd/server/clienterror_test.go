package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/logx"
	"github.com/maciekgangus/inkroom/server/internal/metrics"
)

type logBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *logBuf) Write(p []byte) (int, error) { l.mu.Lock(); defer l.mu.Unlock(); return l.b.Write(p) }

// records returns the JSON lines written so far.
func (l *logBuf) records(t *testing.T) []map[string]any {
	t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []map[string]any
	sc := bufio.NewScanner(bytes.NewReader(l.b.Bytes()))
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("not JSON: %q", sc.Text())
		}
		out = append(out, m)
	}
	return out
}

func (l *logBuf) String() string { l.mu.Lock(); defer l.mu.Unlock(); return l.b.String() }

// clientErrors keeps only the lines of the client service.
func (l *logBuf) clientErrors(t *testing.T) []map[string]any {
	var out []map[string]any
	for _, r := range l.records(t) {
		if r["service"] == "client" {
			out = append(out, r)
		}
	}
	return out
}

// captureLogs sends the logs of the test to a buffer; call it before startApp.
func captureLogs(t *testing.T) *logBuf {
	t.Helper()
	buf := &logBuf{}
	logx.Use(buf, "app", slog.LevelDebug, true)
	t.Cleanup(func() { logx.Use(discardWriter{}, "app", slog.LevelError, true) })
	return buf
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }

func TestClientErrorIsLoggedOnceAsTheClientService(t *testing.T) {
	logs := captureLogs(t)
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	before := metrics.ClientErrors.Value()
	body := `{"message":"x is not a function","source":"https://inkroom.example/assets/index-abc.js?v=1#frag","line":10,"col":5,` +
		`"stack":"TypeError: x is not a function\n    at a (index-abc.js:10:5)","page":"https://inkroom.example/b/SECRETBOARD?token=zzz#h","screen":"1024x768","release":"0.7.1"}`
	if got := status(call(t, srv, "POST", "/api/client-error", body, nil)); got != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", got)
	}
	ls := logs.clientErrors(t)
	if len(ls) != 1 {
		t.Fatalf("client lines = %v", ls)
	}
	l := ls[0]
	if l["level"] != "WARN" || l["msg"] != "client error" || l["message"] != "x is not a function" ||
		l["source"] != "/assets/index-abc.js" || l["page"] != "/b/:id" || l["screen"] != "1024x768" ||
		l["release"] != "0.7.1" || l["line"] != float64(10) || l["col"] != float64(5) || l["user"] != "guest" {
		t.Errorf("record %v", l)
	}
	if !strings.Contains(l["stack"].(string), "index-abc.js:10:5") {
		t.Errorf("stack lost: %v", l["stack"])
	}
	for _, secret := range []string{"SECRETBOARD", "zzz", "token="} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("log leaks %q", secret)
		}
	}
	if metrics.ClientErrors.Value() != before+1 {
		t.Error("inkroom_client_errors_total did not move")
	}
}

func TestClientErrorNamesTheAccountByIdNeverByEmailOrName(t *testing.T) {
	logs := captureLogs(t)
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	u := register(t, srv, "someone@example.com")
	call(t, srv, "POST", "/api/client-error", `{"message":"boom"}`, &u).Body.Close()
	ls := logs.clientErrors(t)
	if len(ls) != 1 || !strings.HasPrefix(ls[0]["user"].(string), "u:") {
		t.Fatalf("lines = %v", ls)
	}
	for _, secret := range []string{"someone@example.com", "someone-user"} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("log leaks %q", secret)
		}
	}
}

func TestClientErrorIsChecked(t *testing.T) {
	logs := captureLogs(t)
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	for name, body := range map[string]string{
		"empty message": `{"message":"  "}`,
		"not a body":    `nope`,
		"too big":       `{"message":"` + strings.Repeat("a", 5000) + `"}`,
	} {
		if got := status(call(t, srv, "POST", "/api/client-error", body, nil)); got != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", name, got)
		}
	}
	req, _ := http.NewRequest("POST", srv.URL+"/api/client-error", strings.NewReader(`{"message":"x"}`))
	req.Header.Set("Content-Type", "text/plain")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || status(resp) != http.StatusUnsupportedMediaType {
		t.Errorf("wrong content type: %v %v", resp, err)
	}
	if n := len(logs.clientErrors(t)); n != 0 {
		t.Errorf("%d lines for rejected reports", n)
	}
}

func TestClientErrorFieldsAreCut(t *testing.T) {
	logs := captureLogs(t)
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	body := `{"message":"` + strings.Repeat("m", 3000) + `","stack":"` + strings.Repeat("s", 900) + `"}`
	if got := status(call(t, srv, "POST", "/api/client-error", body, nil)); got != http.StatusNoContent {
		t.Fatalf("status = %d", got)
	}
	l := logs.clientErrors(t)[0]
	if n := len(l["message"].(string)); n > maxClientMessage {
		t.Errorf("message = %d chars", n)
	}
	if n := len(l["stack"].(string)); n > maxClientStack {
		t.Errorf("stack = %d chars", n)
	}
}

func TestClientErrorsAreLimitedPerPerson(t *testing.T) {
	logs := captureLogs(t)
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	u := register(t, srv, "noisy@example.com")
	for i := 0; i < clientErrorsPerHour; i++ {
		if got := status(call(t, srv, "POST", "/api/client-error", `{"message":"x"}`, &u)); got != http.StatusNoContent {
			t.Fatalf("report %d = %d", i, got)
		}
	}
	if got := status(call(t, srv, "POST", "/api/client-error", `{"message":"x"}`, &u)); got != http.StatusTooManyRequests {
		t.Fatalf("over the limit = %d, want 429", got)
	}
	if n := len(logs.clientErrors(t)); n != clientErrorsPerHour {
		t.Errorf("%d lines, want %d", n, clientErrorsPerHour)
	}
}

func TestRateLimiterWindowAndBoundedMemory(t *testing.T) {
	now := time.Unix(1000, 0)
	l := newRateLimiter(func() time.Time { return now }, 3, time.Hour, 5)
	for i := 0; i < 3; i++ {
		if !l.allow("a") {
			t.Fatalf("call %d refused", i)
		}
	}
	if l.allow("a") {
		t.Error("fourth call allowed")
	}
	if !l.allow("b") {
		t.Error("another key must have its own allowance")
	}
	now = now.Add(61 * time.Minute)
	if !l.allow("a") {
		t.Error("the window did not slide")
	}
	for i := 0; i < 50; i++ { // many different keys must not grow the map without bound
		l.allow(string(rune('A' + i)))
	}
	if n := l.size(); n > 10 {
		t.Errorf("limiter holds %d keys", n)
	}
}

func TestSanitizePageKeepsOnlyThePathWithoutBoardIds(t *testing.T) {
	for in, want := range map[string]string{
		"https://x.dev/b/abc123?token=1#h": "/b/:id",
		"/b/abc123":                        "/b/:id",
		"/register":                        "/register",
		"https://x.dev/":                   "/",
		"":                                 "",
		"%%%not a url":                     "",
	} {
		if got := sanitizePage(in); got != want {
			t.Errorf("sanitizePage(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBoardIdsAreMaskedEverywhereInAReport(t *testing.T) {
	logs := captureLogs(t)
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "t.db"), t.TempDir())
	body := `{"message":"Failed to fetch https://x.dev/api/boards/SECRETONE/images/h1 and ws://x.dev/ws/SECRETTWO","source":"https://x.dev/b/SECRETTHREE",` +
		`"stack":"Error\n    at f (https://x.dev/b/SECRETTHREE:1:5)\n    at g (https://x.dev/assets/a.js:2:3)","page":"/b/SECRETFOUR"}`
	if got := status(call(t, srv, "POST", "/api/client-error", body, nil)); got != http.StatusNoContent {
		t.Fatalf("status = %d", got)
	}
	out := logs.String()
	for _, secret := range []string{"SECRETONE", "SECRETTWO", "SECRETTHREE", "SECRETFOUR"} {
		if strings.Contains(out, secret) {
			t.Errorf("log leaks %s: %s", secret, out)
		}
	}
	l := logs.clientErrors(t)[0]
	if !strings.Contains(l["stack"].(string), "/assets/a.js:2:3") || !strings.Contains(l["message"].(string), "/api/boards/:id/images/h1") {
		t.Errorf("the rest of the report must survive: %v", l)
	}
}
