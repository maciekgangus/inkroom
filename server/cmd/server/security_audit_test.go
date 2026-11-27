package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// Security audit 2026-11: tests for the fixes (headers, rate limits, quotas, dev guards).

func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	srv, _, _ := testApp(t)
	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	h := resp.Header
	if h.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}
	if h.Get("X-Frame-Options") != "DENY" {
		t.Error("missing X-Frame-Options: DENY")
	}
	if h.Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
		t.Error("missing Referrer-Policy")
	}
	if csp := h.Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") || !strings.Contains(csp, "object-src 'none'") {
		t.Errorf("bad CSP: %q", csp)
	}
}

func TestAdminPageKeepsItsOwnStrictCSP(t *testing.T) {
	srv, a, _ := testApp(t)
	a.configureAdminDev(true) // direct request, no proxy headers: the page opens locally
	resp, err := http.Get(srv.URL + "/admin")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin page = %d", resp.StatusCode)
	}
	csp := resp.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'unsafe-inline'") || strings.Contains(csp, "challenges.cloudflare.com") {
		t.Errorf("admin CSP should allow only its own inline script: %q", csp)
	}
	if resp.Header.Get("X-Robots-Tag") == "" {
		t.Error("admin page should stay noindex")
	}
}

func TestWSMessageRateLimit(t *testing.T) {
	srv, _, _ := testApp(t)
	id := newBoard(t, srv)
	c := dial(t, srv, id)
	read(t, c) // the snapshot
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for i := 0; i < maxWSMessages; i++ {
		if err := c.Write(ctx, websocket.MessageText, []byte(`{"t":"ping"}`)); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	// One more than the limit: the server closes the connection as misbehaving.
	_ = c.Write(ctx, websocket.MessageText, []byte(`{"t":"ping"}`))
	// Drain the pongs still queued, then the close must arrive.
	for {
		_, _, err := c.Read(ctx)
		if err != nil {
			var ce websocket.CloseError
			if !errors.As(err, &ce) || ce.Code != websocket.StatusPolicyViolation {
				t.Fatalf("expected policy-violation close, got %v", err)
			}
			return
		}
	}
}

// pngMagic is enough for http.DetectContentType to report image/png.
var pngMagic = []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 32))

func TestUploadRateLimitPerIP(t *testing.T) {
	srv, _, _ := testApp(t)
	id := newBoard(t, srv)
	for i := 0; i < maxImageUploadsPerIP; i++ {
		resp, err := http.Post(srv.URL+"/api/boards/"+id+"/images", "application/octet-stream", strings.NewReader(string(pngMagic)))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("upload %d = %d", i, resp.StatusCode)
		}
	}
	resp, err := http.Post(srv.URL+"/api/boards/"+id+"/images", "application/octet-stream", strings.NewReader(string(pngMagic)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("upload past the limit = %d, want 429", resp.StatusCode)
	}
}

func TestPasswordChangeEndsOtherSessions(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	// A second session for the same account.
	resp := call(t, srv, "POST", "/api/login", `{"login":"a@example.com","password":"password1"}`, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login = %d", resp.StatusCode)
	}
	var second *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == "session" {
			second = c
		}
	}
	if second == nil {
		t.Fatal("no session cookie on login")
	}
	// Change the password from the first session.
	resp = call(t, srv, "POST", "/api/account/password", `{"current":"password1","new":"password2"}`, &u)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("password change = %d", resp.StatusCode)
	}
	// The old session is gone, the current one still works.
	req, _ := http.NewRequest("GET", srv.URL+"/api/me", nil)
	req.AddCookie(second)
	r2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r2.Body.Close()
	if r2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old session after password change = %d, want 401", r2.StatusCode)
	}
	resp = call(t, srv, "GET", "/api/me", "", &u)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("current session after password change = %d, want 200", resp.StatusCode)
	}
}

func TestListenAddrGuardsDevSwitches(t *testing.T) {
	t.Setenv("BIND_ADDR", "")
	t.Setenv("PORT", "8080")
	t.Setenv("ADMIN_DEV_OPEN", "")
	t.Setenv("SEED_USER_EMAIL", "")
	t.Setenv("SEED_USER_PASSWORD", "")
	if got := listenAddr(); got != ":8080" {
		t.Fatalf("default bind = %q", got)
	}
	t.Setenv("ADMIN_DEV_OPEN", "1")
	if got := listenAddr(); got != "127.0.0.1:8080" {
		t.Fatalf("dev admin with default bind = %q, want loopback", got)
	}
	t.Setenv("BIND_ADDR", "0.0.0.0:9000") // explicit: the operator's choice, e.g. docker compose
	if got := listenAddr(); got != "0.0.0.0:9000" {
		t.Fatalf("explicit BIND_ADDR = %q", got)
	}
	for addr, want := range map[string]bool{":8080": true, "0.0.0.0:8080": true, "[::]:8080": true, "127.0.0.1:8080": false, "localhost:8080": false} {
		if got := publicBind(addr); got != want {
			t.Errorf("publicBind(%q) = %v, want %v", addr, got, want)
		}
	}
}

// A board near its quota tells the author of a stroke that does not fit, and keeps the
// connection: closing it made the client reconnect and send the stroke again, forever.
func TestFullBoardSendsFullAndKeepsTheConnection(t *testing.T) {
	old := store.MaxBoardBytes
	store.MaxBoardBytes = 200 // two 40-byte images + one 78-byte stroke fit, a second stroke does not
	defer func() { store.MaxBoardBytes = old }()
	srv, a, _ := testApp(t)
	id := newBoard(t, srv)
	upload := func() {
		t.Helper()
		resp, err := http.Post(srv.URL+"/api/boards/"+id+"/images", "application/octet-stream", strings.NewReader(string(pngMagic)))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("upload = %d", resp.StatusCode)
		}
	}
	upload() // before anyone joins: the room reads it on loading
	c := dial(t, srv, id)
	read(t, c) // the snapshot
	upload()   // while the room is loaded: the room is told
	write(t, c, stroke)
	if m := read(t, c); m["t"] != "add" {
		t.Fatalf("got %v, want the add echoed", m)
	}
	write(t, c, strings.Replace(stroke, `"s1"`, `"s2"`, 1))
	if m := read(t, c); m["t"] != "full" || m["id"] != "s2" {
		t.Fatalf("got %v, want full for s2", m)
	}
	write(t, c, `{"t":"ping"}`)
	if m := read(t, c); m["t"] != "pong" {
		t.Fatalf("got %v, want pong on the same connection", m)
	}
	a.hub.Flush()
	strokes, err := a.st.LoadStrokes(id)
	if err != nil || len(strokes) != 1 {
		t.Fatalf("saved %d strokes (%v), want s1 only", len(strokes), err)
	}
}

// A 144 Hz screen sends a live stroke or the laser every frame plus the cursor: that is normal use
// and must never be cut off, while a flood still is.
func TestWSBudgetLetsAFastScreenThroughAndStopsAFlood(t *testing.T) {
	now := time.Unix(1000, 0)
	b := newMsgBudget(func() time.Time { return now }, maxWSMessages, wsRateWindow)
	// 150 messages a second for a minute.
	for i := 0; i < 150*60; i++ {
		if !b.allow() {
			t.Fatalf("message %d at 150/s refused", i)
		}
		now = now.Add(time.Second / 150)
	}
	// A flood in one window is refused once it passes the limit...
	now = now.Add(wsRateWindow)
	for i := 0; i < maxWSMessages; i++ {
		if !b.allow() {
			t.Fatalf("message %d of the window refused", i)
		}
	}
	if b.allow() {
		t.Fatal("a message over the limit was allowed")
	}
	// ...and the next window starts afresh.
	now = now.Add(wsRateWindow)
	if !b.allow() {
		t.Fatal("the next window should allow again")
	}
	if maxWSMessages < 300*int(wsRateWindow/time.Second) {
		t.Fatalf("limit %d per %v is too close to a 144 Hz screen's rate", maxWSMessages, wsRateWindow)
	}
}
