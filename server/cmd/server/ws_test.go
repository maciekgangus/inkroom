package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func newBoard(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	return createBoard(t, srv, register(t, srv, "owner@example.com"), "Test")
}

func dial(t *testing.T, srv *httptest.Server, id string) *websocket.Conn {
	return dialAs(t, srv, id, nil)
}

func dialAs(t *testing.T, srv *httptest.Server, id string, u *user) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	opts := &websocket.DialOptions{}
	if u != nil {
		opts.HTTPHeader = http.Header{"Cookie": []string{u.cookie.String()}}
	}
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+id, opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func read(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func write(t *testing.T, c *websocket.Conn, msg string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
		t.Fatal(err)
	}
}

const stroke = `{"t":"add","stroke":{"id":"s1","authorId":"a","color":"#111","size":4,"z":1,"points":[[0,0,0.5]]}}`

func TestTwoClientsSeeEachOthersStrokes(t *testing.T) {
	srv, _, _ := testApp(t)
	id := newBoard(t, srv)

	a, b := dial(t, srv, id), dial(t, srv, id)
	if m := read(t, a); m["t"] != "snapshot" {
		t.Fatalf("got %v", m)
	}
	if m := read(t, b); m["t"] != "snapshot" {
		t.Fatalf("got %v", m)
	}

	write(t, a, stroke)
	for _, c := range []*websocket.Conn{a, b} {
		if m := read(t, c); m["t"] != "add" {
			t.Fatalf("got %v", m)
		}
	}

	late := dial(t, srv, id)
	m := read(t, late)
	if n := len(m["strokes"].([]any)); n != 1 {
		t.Fatalf("snapshot has %d strokes, want 1", n)
	}
}

func TestLiveStrokeReachesTheOtherClient(t *testing.T) {
	srv, _, _ := testApp(t)
	id := newBoard(t, srv)
	a, b := dial(t, srv, id), dial(t, srv, id)
	read(t, a)
	read(t, b)

	write(t, a, `{"t":"live","id":"s9","authorId":"a","color":"#111","size":4,"points":[[1,1,0.5]]}`)
	if m := read(t, b); m["t"] != "live" || m["id"] != "s9" {
		t.Fatalf("got %v", m)
	}
}

func TestUnknownBoardIs404(t *testing.T) {
	srv, _, _ := testApp(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/nope", nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("err=%v resp=%v", err, resp)
	}
}

func TestInvalidMessageClosesTheConnection(t *testing.T) {
	srv, _, _ := testApp(t)
	a := dial(t, srv, newBoard(t, srv))
	read(t, a)
	write(t, a, `{"t":"nope"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, _, err := a.Read(ctx); err == nil {
		t.Fatal("expected the connection to be closed")
	}
}

func TestBoardPageServesIndexHTML(t *testing.T) {
	dir := t.TempDir()
	if err := writeFile(dir+"/index.html", "<html>app</html>"); err != nil {
		t.Fatal(err)
	}
	srv, _, _ := startApp(t, filepath.Join(t.TempDir(), "x.db"), dir)
	resp, err := http.Get(srv.URL + "/b/abc123")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /b/abc123 = %d", resp.StatusCode)
	}
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o644)
}

func TestStrokesSurviveARestart(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "restart.db")
	staticDir := t.TempDir()

	srv1, app1, _ := startApp(t, dbPath, staticDir)
	owner := register(t, srv1, "owner@example.com")
	id := createBoard(t, srv1, owner, "Matma")
	a := dialAs(t, srv1, id, &owner)
	read(t, a)
	write(t, a, stroke)
	read(t, a) // echo: the server has it
	a.Close(websocket.StatusNormalClosure, "")
	app1.Close() // graceful shutdown saves everything
	srv1.Close()

	srv2, _, _ := startApp(t, dbPath, staticDir)
	// Sessions live in the database too, so the old cookie still works.
	b := dialAs(t, srv2, id, &owner)
	m := read(t, b)
	if n := len(m["strokes"].([]any)); n != 1 {
		t.Fatalf("after restart the snapshot has %d strokes, want 1", n)
	}
}

func TestVisitedBoardsAreListedForLoggedInGuests(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "owner@example.com")
	student := register(t, srv, "student@example.com")
	id := createBoard(t, srv, owner, "Matma")

	own := dialAs(t, srv, id, &owner)
	read(t, own)
	c := dialAs(t, srv, id, &student)
	read(t, c)

	deadline := time.Now().Add(2 * time.Second)
	for {
		m := decode(t, call(t, srv, "GET", "/api/boards", "", &student))
		if v := m["visited"].([]any); len(v) == 1 && v[0].(map[string]any)["id"] == id {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("visited list never showed the board: %v", m)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if m := decode(t, call(t, srv, "GET", "/api/boards", "", &owner)); len(m["visited"].([]any)) != 0 {
		t.Fatalf("owner's own board must not be listed as visited: %v", m)
	}
}

func TestDeletingABoardDisconnectsEveryone(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "owner@example.com")
	id := createBoard(t, srv, owner, "Matma")
	guest := dial(t, srv, id)
	read(t, guest)

	if got := status(call(t, srv, "DELETE", "/api/boards/"+id, "", &owner)); got != http.StatusNoContent {
		t.Fatalf("delete = %d", got)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, _, err := guest.Read(ctx); err == nil {
		t.Fatal("guest should have been disconnected")
	}
	if got := status(call(t, srv, "GET", "/b/"+id, "", nil)); got == 0 {
		t.Fatal("unreachable")
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel2()
	_, resp, err := websocket.Dial(ctx2, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+id, nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("deleted board must 404 on websocket: err=%v resp=%v", err, resp)
	}
}

// dialWith joins a board's socket with a query string, as the client does to say who it is.
func dialWith(t *testing.T, srv *httptest.Server, id, query string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+id+"?"+query, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func TestAClientThatSaysWhoItIsIsListedToEveryone(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	id := createBoard(t, srv, owner, "Matma")

	ann := dialWith(t, srv, id, "id=a1&name=Ann")
	read(t, ann) // snapshot
	if m := read(t, ann); m["t"] != "peers" || len(m["peers"].([]any)) != 1 {
		t.Fatalf("joiner: got %v", m)
	}
	bob := dialWith(t, srv, id, "id=b1&name=Bob")
	read(t, bob) // snapshot
	for _, c := range []*websocket.Conn{ann, bob} {
		m := read(t, c)
		if m["t"] != "peers" || len(m["peers"].([]any)) != 2 {
			t.Fatalf("after Bob joined: got %v", m)
		}
	}
	bob.CloseNow()
	if m := read(t, ann); m["t"] != "peers" || len(m["peers"].([]any)) != 1 {
		t.Fatalf("after Bob left: got %v", m)
	}
}

func TestAnonymousSocketsAreNotListed(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	id := createBoard(t, srv, owner, "Matma")
	ws := dial(t, srv, id)
	if m := read(t, ws); m["t"] != "snapshot" {
		t.Fatalf("got %v", m)
	}
}

func TestRenamingTheBoardIsPushedToEveryoneOnIt(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	id := createBoard(t, srv, owner, "Matma")
	ws := dial(t, srv, id)
	read(t, ws) // snapshot
	if got := status(call(t, srv, "PATCH", "/api/boards/"+id, `{"name":"Lekcja 5"}`, &owner)); got != http.StatusNoContent {
		t.Fatalf("rename = %d", got)
	}
	if m := read(t, ws); m["t"] != "name" || m["value"] != "Lekcja 5" {
		t.Fatalf("live rename: got %v", m)
	}
	if m := decode(t, call(t, srv, "GET", "/api/boards/"+id, "", nil)); m["name"] != "Lekcja 5" {
		t.Fatalf("stored name: got %v", m)
	}
}

// Big messages (a paste of hundreds of strokes, the whole board for a newcomer) are compressed on
// the wire when the client agrees; the little live messages stay under the compression threshold.
func TestWebSocketCompressesBigMessages(t *testing.T) {
	srv, _, _ := testApp(t)
	id := newBoard(t, srv)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+id, &websocket.DialOptions{
		CompressionMode: websocket.CompressionNoContextTakeover,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	if ext := resp.Header.Get("Sec-WebSocket-Extensions"); !strings.Contains(ext, "permessage-deflate") {
		t.Fatalf("compression was not negotiated: %q", ext)
	}
}
