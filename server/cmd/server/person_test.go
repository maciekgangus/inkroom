package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// dialCookie joins a board's socket with a query string and a Cookie header.
func dialCookie(t *testing.T, srv *httptest.Server, id, query, cookie string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	opts := &websocket.DialOptions{HTTPHeader: http.Header{}}
	if cookie != "" {
		opts.HTTPHeader.Set("Cookie", cookie)
	}
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+id+"?"+query, opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

// fetchGuestCookie asks for the board's page data the way a browser does and returns the guest cookie.
func fetchGuestCookie(t *testing.T, srv *httptest.Server, board string) *http.Cookie {
	t.Helper()
	resp := call(t, srv, "GET", "/api/boards/"+board, "", nil)
	defer resp.Body.Close()
	for _, c := range resp.Cookies() {
		if c.Name == "inkroom_guest" {
			return c
		}
	}
	t.Fatal("no guest cookie")
	return nil
}

func TestAGuestGetsAnUnreadableLongLivedCookieOnce(t *testing.T) {
	srv, _, _ := testApp(t)
	id := newBoard(t, srv)
	c := fetchGuestCookie(t, srv, id)
	if !c.HttpOnly || c.MaxAge < 30*24*3600 || len(c.Value) != 64 || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie = %+v", c)
	}
	// Coming back with the cookie, the guest is not given another one.
	resp := call(t, srv, "GET", "/api/boards/"+id, "", &user{cookie: c})
	defer resp.Body.Close()
	for _, k := range resp.Cookies() {
		if k.Name == "inkroom_guest" {
			t.Fatal("a returning guest was given a new cookie")
		}
	}
}

func TestTakingAwayDrawingStaysWithTheGuestCookieWhateverTheClientSays(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	id := createBoard(t, srv, owner, "Matma")
	ann := fetchGuestCookie(t, srv, id)
	annCookie := ann.Name + "=" + ann.Value

	ownerWS := dialCookie(t, srv, id, "id=own&name=Own", owner.cookie.String())
	read(t, ownerWS) // snapshot
	read(t, ownerWS) // peers
	annWS := dialCookie(t, srv, id, "id=ann&name=Ann", annCookie)
	read(t, annWS) // snapshot
	read(t, annWS) // peers
	read(t, ownerWS)

	write(t, ownerWS, `{"t":"perm","id":"ann","draw":false}`)
	if m := read(t, ownerWS); m["t"] != "peers" {
		t.Fatalf("got %v", m)
	}
	read(t, annWS)

	// She reconnects under a new author id, as another tab or a cleared storage would: still muted.
	again := dialCookie(t, srv, id, "id=ann-new&name=Ann", annCookie)
	read(t, again) // snapshot
	read(t, again) // peers
	write(t, again, `{"t":"add","stroke":{"id":"s1","authorId":"x","color":"#111","size":4,"points":[[1,1,0.5]]}}`)
	if m := read(t, again); m["t"] != "snapshot" {
		t.Fatalf("a muted guest's drawing was accepted: %v", m)
	}

	// Somebody else, with their own cookie, can draw.
	bob := fetchGuestCookie(t, srv, id)
	bobWS := dialCookie(t, srv, id, "id=bob&name=Bob", bob.Name+"="+bob.Value)
	read(t, bobWS) // snapshot
	write(t, bobWS, `{"t":"add","stroke":{"id":"s2","authorId":"bob","color":"#111","size":4,"points":[[1,1,0.5]]}}`)
	for {
		m := read(t, bobWS)
		if m["t"] == "add" {
			break
		}
	}
}

func TestOnlyTheOwnersAccountCanChangeRights(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	id := createBoard(t, srv, owner, "Matma")
	ann := fetchGuestCookie(t, srv, id)

	annWS := dialCookie(t, srv, id, "id=ann&name=Ann", ann.Name+"="+ann.Value)
	read(t, annWS)
	read(t, annWS)
	otherWS := dialCookie(t, srv, id, "id=oth&name=Oth", other.cookie.String()) // logged in, but not the owner
	read(t, otherWS)
	read(t, otherWS)
	read(t, annWS)

	write(t, otherWS, `{"t":"perm","id":"ann","draw":false}`)
	write(t, annWS, `{"t":"add","stroke":{"id":"s1","authorId":"ann","color":"#111","size":4,"points":[[1,1,0.5]]}}`)
	if m := read(t, annWS); m["t"] != "add" {
		t.Fatalf("a non-owner took rights away: %v", m)
	}
}
