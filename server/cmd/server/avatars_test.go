package main

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/coder/websocket"
)

func TestAvatarIsChosenFromTheListAndShownInMe(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	ann := register(t, srv, "ann@example.com")
	if got := decode(t, call(t, srv, "GET", "/api/me", "", &ann)); got["avatar"] != "" {
		t.Fatalf("fresh account: %v", got)
	}
	if c := status(call(t, srv, "PUT", "/api/account/avatar", `{"avatar":"fox"}`, &ann)); c != http.StatusNoContent {
		t.Fatalf("put = %d", c)
	}
	if got := decode(t, call(t, srv, "GET", "/api/me", "", &ann)); got["avatar"] != "fox" {
		t.Fatalf("me = %v", got)
	}
	// No avatar again: the first letter.
	if c := status(call(t, srv, "PUT", "/api/account/avatar", `{"avatar":""}`, &ann)); c != http.StatusNoContent {
		t.Fatalf("clear = %d", c)
	}
	if got := decode(t, call(t, srv, "GET", "/api/me", "", &ann)); got["avatar"] != "" {
		t.Fatalf("me = %v", got)
	}
}

func TestAvatarNeedsLoginAndAKnownPicture(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	if c := status(call(t, srv, "PUT", "/api/account/avatar", `{"avatar":"fox"}`, nil)); c != http.StatusUnauthorized {
		t.Fatalf("guest = %d", c)
	}
	ann := register(t, srv, "ann@example.com")
	for _, body := range []string{`{"avatar":"../../etc/passwd"}`, `{"avatar":"not-a-picture"}`, `{"avatar":5}`, `nope`} {
		if c := status(call(t, srv, "PUT", "/api/account/avatar", body, &ann)); c != http.StatusBadRequest {
			t.Fatalf("%s = %d", body, c)
		}
	}
}

func TestTheAvatarIsOnTheBoardAndChangesThereAtOnce(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	ann := register(t, srv, "ann@example.com")
	board := createBoard(t, srv, ann, "Lekcja")
	call(t, srv, "PUT", "/api/account/avatar", `{"avatar":"fox"}`, &ann).Body.Close()

	c := dialCookie(t, srv, board, "id=a1&name=ann", ann.cookie.String())
	peers := readUntil(t, c, "peers")
	if peerAvatar(peers, "a1") != "fox" {
		t.Fatalf("peers = %v", peers)
	}
	call(t, srv, "PUT", "/api/account/avatar", `{"avatar":"owl"}`, &ann).Body.Close()
	if peers = readUntil(t, c, "peers"); peerAvatar(peers, "a1") != "owl" {
		t.Fatalf("peers after the change = %v", peers)
	}
}

// readUntil reads messages until one of the kind comes.
func readUntil(t *testing.T, c *websocket.Conn, kind string) map[string]any {
	t.Helper()
	for i := 0; i < 20; i++ {
		if m := read(t, c); m["t"] == kind {
			return m
		}
	}
	t.Fatalf("no %q message", kind)
	return nil
}

func peerAvatar(m map[string]any, id string) string {
	for _, p := range m["peers"].([]any) {
		if q := p.(map[string]any); q["id"] == id {
			v, _ := q["avatar"].(string)
			return v
		}
	}
	return ""
}

// The list the server accepts is exactly the pictures the client ships.
func TestAvatarListMatchesThePictures(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "web", "public", "avatars", "*.svg"))
	if err != nil || len(files) == 0 {
		t.Skip("web/public/avatars is not here")
	}
	var names []string
	for _, f := range files {
		names = append(names, strings.TrimSuffix(filepath.Base(f), ".svg"))
	}
	var listed []string
	for id := range avatarIDs {
		listed = append(listed, id)
	}
	sort.Strings(names)
	sort.Strings(listed)
	if strings.Join(names, ",") != strings.Join(listed, ",") {
		t.Fatalf("files %v, list %v", names, listed)
	}
	if _, err := os.Stat(filepath.Join("..", "..", "..", "web", "public", "avatars", "LICENSE.txt")); err != nil {
		t.Fatal("the licence of the pictures is missing")
	}
}
