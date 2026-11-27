package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// dialAsWith joins a board's socket logged in as u, with the query string the client sends.
func dialAsWith(t *testing.T, srv *httptest.Server, id, query string, u *user) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	opts := &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": []string{u.cookie.String()}}}
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws/"+id+"?"+query, opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

// readPeers reads messages until a peers list with n entries arrives.
func readPeers(t *testing.T, c *websocket.Conn, n int) []any {
	t.Helper()
	for range 20 {
		m := read(t, c)
		if m["t"] == "peers" && len(m["peers"].([]any)) == n {
			return m["peers"].([]any)
		}
	}
	t.Fatalf("no peers list with %d entries", n)
	return nil
}

func bodyText(t *testing.T, resp *http.Response) (int, string) {
	t.Helper()
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func accountID(t *testing.T, a *app, login string) int64 {
	t.Helper()
	u, err := a.st.UserByLogin(login)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

// A logged-in person is listed under their account's name, never the name the URL states, so
// nobody can pose as another account to an owner who then grants that account rights.
func TestLoggedInPeerIsListedUnderTheAccountName(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "owner@example.com")
	mallory := register(t, srv, "mallory@example.com")
	_ = register(t, srv, "ania@example.com")
	id := createBoard(t, srv, owner, "Matma")

	c := dialAsWith(t, srv, id, "id=m1&name=ania-user", &mallory)
	peers := readPeers(t, c, 1)
	if got := peers[0].(map[string]any)["name"]; got != "mallory-user" {
		t.Fatalf("logged-in peer listed as %v, want mallory-user", got)
	}
}

// Adding a contact by account id works only for people the caller is connected to (R-053, R-123):
// an unrelated id gets the same answer as a missing one and no account data.
func TestAddContactByUserIDRefusesUnrelatedAccounts(t *testing.T) {
	srv, a, _ := testApp(t)
	alice := register(t, srv, "alice@example.com")
	_ = register(t, srv, "stranger@example.com")
	strangerID := accountID(t, a, "stranger-user")

	code, body := bodyText(t, call(t, srv, "POST", "/api/contacts", fmt.Sprintf(`{"userId":%d}`, strangerID), &alice))
	missingCode, missingBody := bodyText(t, call(t, srv, "POST", "/api/contacts", `{"userId":999999}`, &alice))
	if code != http.StatusNotFound || strings.Contains(body, "stranger") {
		t.Fatalf("unrelated userId = %d %s", code, body)
	}
	if code != missingCode || body != missingBody {
		t.Fatalf("unrelated (%d %s) differs from missing (%d %s)", code, body, missingCode, missingBody)
	}
}

// Two visitors on a third person's board see each other live and may befriend by id.
func TestAddContactByUserIDWorksForALivePeer(t *testing.T) {
	srv, a, _ := testApp(t)
	owner := register(t, srv, "owner@example.com")
	alice := register(t, srv, "alice@example.com")
	bob := register(t, srv, "bob@example.com")
	id := createBoard(t, srv, owner, "Matma")

	ca := dialAsWith(t, srv, id, "id=a1&name=alice-user", &alice)
	readPeers(t, ca, 1)
	cb := dialAsWith(t, srv, id, "id=b1&name=bob-user", &bob)
	readPeers(t, cb, 2)

	resp := call(t, srv, "POST", "/api/contacts", fmt.Sprintf(`{"userId":%d}`, accountID(t, a, "bob-user")), &alice)
	if code, body := bodyText(t, resp); code != http.StatusCreated {
		t.Fatalf("add live peer = %d %s", code, body)
	}
}

// Co-ownership and transfers go only to people the caller is connected to, with one generic
// answer for a missing account and a refused one, so no e-mail can be probed (R-122).
func TestOwnershipRecipientsMustBeConnected(t *testing.T) {
	srv, _, _ := testApp(t)
	alice := register(t, srv, "alice@example.com")
	_ = register(t, srv, "stranger@example.com")
	b1 := createBoard(t, srv, alice, "Algebra")

	cases := []struct{ path, stranger, missing string }{
		{"/api/boards/" + b1 + "/owners", `{"login":"stranger@example.com"}`, `{"login":"nobody@example.com"}`},
		{"/api/boards/" + b1 + "/transfer", `{"login":"stranger@example.com"}`, `{"login":"nobody@example.com"}`},
		{"/api/boards/transfer", fmt.Sprintf(`{"boardIds":[%q],"login":"stranger@example.com"}`, b1), fmt.Sprintf(`{"boardIds":[%q],"login":"nobody@example.com"}`, b1)},
	}
	for _, c := range cases {
		code, body := bodyText(t, call(t, srv, "POST", c.path, c.stranger, &alice))
		missingCode, missingBody := bodyText(t, call(t, srv, "POST", c.path, c.missing, &alice))
		if code == http.StatusOK || strings.Contains(body, "stranger") {
			t.Fatalf("%s to unrelated account = %d %s", c.path, code, body)
		}
		if code != missingCode || body != missingBody {
			t.Fatalf("%s: unrelated (%d %s) differs from missing (%d %s)", c.path, code, body, missingCode, missingBody)
		}
	}

	// Once the stranger is a saved contact, they can be made a co-owner.
	if got := status(call(t, srv, "POST", "/api/contacts", `{"login":"stranger-user"}`, &alice)); got != http.StatusCreated {
		t.Fatalf("add contact = %d", got)
	}
	if code, body := bodyText(t, call(t, srv, "POST", "/api/boards/"+b1+"/owners", `{"login":"stranger-user"}`, &alice)); code != http.StatusOK {
		t.Fatalf("add contact as co-owner = %d %s", code, body)
	}
}

// The person card adds a co-owner by account id, the one the server vouches for, never by the
// name a peer displays (R-123).
func TestAddBoardOwnerByUserIDOfALivePeer(t *testing.T) {
	srv, a, _ := testApp(t)
	alice := register(t, srv, "alice@example.com")
	bob := register(t, srv, "bob@example.com")
	id := createBoard(t, srv, alice, "Matma")

	ca := dialAsWith(t, srv, id, "id=a1&name=alice-user", &alice)
	readPeers(t, ca, 1)
	cb := dialAsWith(t, srv, id, "id=b1&name=bob-user", &bob)
	readPeers(t, cb, 2)

	bobID := accountID(t, a, "bob-user")
	resp := call(t, srv, "POST", "/api/boards/"+id+"/owners", fmt.Sprintf(`{"userId":%d}`, bobID), &alice)
	code, body := bodyText(t, resp)
	if code != http.StatusOK || !strings.Contains(body, `"username":"bob-user"`) {
		t.Fatalf("add live peer as co-owner = %d %s", code, body)
	}
	if got := decode(t, call(t, srv, "GET", "/api/boards/"+id, "", &bob))["owner"]; got != true {
		t.Fatalf("bob owner = %v, want true", got)
	}
}
