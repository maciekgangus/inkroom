package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func newBoard(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	resp, err := http.Post(srv.URL+"/api/boards", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /api/boards = %d", resp.StatusCode)
	}
	var body struct{ ID string }
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || len(body.ID) != 32 {
		t.Fatalf("bad body %+v %v", body, err)
	}
	return body.ID
}

func dial(t *testing.T, srv *httptest.Server, id string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+id, nil)
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
	srv := httptest.NewServer(newHandler(t.TempDir()))
	defer srv.Close()
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
	srv := httptest.NewServer(newHandler(t.TempDir()))
	defer srv.Close()
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
	srv := httptest.NewServer(newHandler(t.TempDir()))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/nope", nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusNotFound {
		t.Fatalf("err=%v resp=%v", err, resp)
	}
}

func TestInvalidMessageClosesTheConnection(t *testing.T) {
	srv := httptest.NewServer(newHandler(t.TempDir()))
	defer srv.Close()
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
	srv := httptest.NewServer(newHandler(dir))
	defer srv.Close()
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
