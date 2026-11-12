package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// devAdmin is an app with the development switch on: the panel needs no token, which keeps these
// tests on what the panel does. The gate itself is tested in admin_test.go.
func devAdmin(t *testing.T) adminEnv {
	t.Helper()
	e := newAdminEnv(t, false)
	e.app.configureAdminDev(true)
	return e
}

func (e adminEnv) json(t *testing.T, method, path, body string) (int, map[string]any, []map[string]any) {
	t.Helper()
	resp, text := e.do(t, method, path, "", method != "GET", body)
	var obj map[string]any
	var arr []map[string]any
	_ = json.Unmarshal([]byte(text), &obj)
	_ = json.Unmarshal([]byte(text), &arr)
	return resp.StatusCode, obj, arr
}

func userID(t *testing.T, e adminEnv, name string) int64 {
	t.Helper()
	u, err := e.app.st.UserByLogin(name)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}

func TestAdminListsUsersAndBoards(t *testing.T) {
	e := devAdmin(t)
	ann := register(t, e.srv, "ann@example.com")
	register(t, e.srv, "bob@example.com")
	createBoard(t, e.srv, ann, "Matma")
	code, _, users := e.json(t, "GET", "/api/admin/users", "")
	if code != 200 || len(users) != 2 {
		t.Fatalf("users = %d %v", code, users)
	}
	var found map[string]any
	for _, u := range users {
		if u["email"] == "ann@example.com" {
			found = u
		}
	}
	if found["username"] != "ann-user" || found["owned"].(float64) != 1 || found["createdAt"] == "" || found["lastActive"] == "" {
		t.Fatalf("ann: %v", found)
	}
	code, _, boards := e.json(t, "GET", "/api/admin/boards", "")
	if code != 200 || len(boards) != 1 || boards[0]["name"] != "Matma" || boards[0]["owner"] != "ann-user" || len(boards[0]["id"].(string)) != 32 {
		t.Fatalf("boards = %d %v", code, boards)
	}
}

func TestAdminRenamesUsers(t *testing.T) {
	e := devAdmin(t)
	register(t, e.srv, "ann@example.com")
	register(t, e.srv, "bob@example.com")
	id := strconv.FormatInt(userID(t, e, "ann-user"), 10)
	path := "/api/admin/users/" + id + "/rename"
	for body, want := range map[string]int{
		`{"username":"Ania.K"}`:        http.StatusNoContent,
		`{"username":"bob-user"}`:      http.StatusConflict,
		`{"username":"Administrator"}`: http.StatusBadRequest,
		`{"username":"a b"}`:           http.StatusBadRequest,
		`{"username":"x"}`:             http.StatusBadRequest,
		`nope`:                         http.StatusBadRequest,
	} {
		if code, _, _ := e.json(t, "POST", path, body); code != want {
			t.Errorf("%s = %d, want %d", body, code, want)
		}
	}
	if code, _, _ := e.json(t, "POST", "/api/admin/users/9999/rename", `{"username":"Ania.K2"}`); code != http.StatusNotFound {
		t.Errorf("a missing user = %d", code)
	}
	if u, err := e.app.st.UserByLogin("ania.k"); err != nil || u.Username != "Ania.K" {
		t.Fatalf("renamed: %+v %v", u, err)
	}
}

func TestAdminLogsAUserOutEverywhere(t *testing.T) {
	e := devAdmin(t)
	ann := register(t, e.srv, "ann@example.com")
	if resp := call(t, e.srv, "GET", "/api/me", "", &ann); status(resp) != 200 {
		t.Fatal("not logged in to begin with")
	}
	id := strconv.FormatInt(userID(t, e, "ann-user"), 10)
	if code, _, _ := e.json(t, "POST", "/api/admin/users/"+id+"/logout", "{}"); code != http.StatusNoContent {
		t.Fatalf("logout = %d", code)
	}
	if resp := call(t, e.srv, "GET", "/api/me", "", &ann); status(resp) != http.StatusUnauthorized {
		t.Fatal("still logged in")
	}
}

func TestAdminDeletesAUserOnlyWithTheirNameTyped(t *testing.T) {
	e := devAdmin(t)
	ann := register(t, e.srv, "ann@example.com")
	bob := register(t, e.srv, "bob@example.com")
	b1 := createBoard(t, e.srv, ann, "Matma")
	b2 := createBoard(t, e.srv, bob, "Chemia")
	conn := dial(t, e.srv, b1)
	read(t, conn)
	id := strconv.FormatInt(userID(t, e, "ann-user"), 10)
	for _, body := range []string{``, `{}`, `{"confirm":"bob-user"}`, `{"confirm":"ANN"}`} {
		if code, _, _ := e.json(t, "DELETE", "/api/admin/users/"+id, body); code != http.StatusBadRequest {
			t.Errorf("%q = %d, want 400", body, code)
		}
	}
	if _, err := e.app.st.Board(b1); err != nil {
		t.Fatal("deleted without the name")
	}
	if code, _, _ := e.json(t, "DELETE", "/api/admin/users/"+id, `{"confirm":"ann-user"}`); code != http.StatusNoContent {
		t.Fatalf("delete = %d", code)
	}
	if _, err := e.app.st.Board(b1); err == nil {
		t.Error("her board survived")
	}
	if _, err := e.app.st.Board(b2); err != nil {
		t.Error("bob's board went too")
	}
	if _, _, err := conn.Read(t.Context()); err == nil {
		t.Error("a client of her board is still connected")
	}
	if code, _, _ := e.json(t, "DELETE", "/api/admin/users/"+id, `{"confirm":"ann-user"}`); code != http.StatusNotFound {
		t.Errorf("deleting again = %d", code)
	}
}

func TestAdminChangesBoards(t *testing.T) {
	e := devAdmin(t)
	ann := register(t, e.srv, "ann@example.com")
	register(t, e.srv, "bob@example.com")
	id := createBoard(t, e.srv, ann, "Matma")
	bob := strconv.FormatInt(userID(t, e, "bob-user"), 10)

	conn := dial(t, e.srv, id)
	read(t, conn)
	if code, _, _ := e.json(t, "POST", "/api/admin/boards/"+id+"/rename", `{"name":"Algebra"}`); code != http.StatusNoContent {
		t.Fatalf("rename = %d", code)
	}
	if m := read(t, conn); m["t"] != "name" || m["value"] != "Algebra" {
		t.Fatalf("the people on the board were not told: %v", m)
	}
	if code, _, _ := e.json(t, "POST", "/api/admin/boards/"+id+"/rename", `{"name":"  "}`); code != http.StatusBadRequest {
		t.Errorf("an empty name = %d", code)
	}
	if code, _, _ := e.json(t, "POST", "/api/admin/boards/"+id+"/owner", `{"userId":`+bob+`}`); code != http.StatusNoContent {
		t.Fatalf("owner = %d", code)
	}
	if b, _ := e.app.st.Board(id); b.OwnerID != userID(t, e, "bob-user") || b.Name != "Algebra" {
		t.Fatalf("board: %+v", b)
	}
	if code, _, _ := e.json(t, "POST", "/api/admin/boards/"+id+"/owner", `{"userId":9999}`); code != http.StatusNotFound {
		t.Errorf("a missing owner = %d", code)
	}
	if code, _, _ := e.json(t, "POST", "/api/admin/boards/nope/rename", `{"name":"x"}`); code != http.StatusNotFound {
		t.Errorf("a missing board = %d", code)
	}

	code, cp, _ := e.json(t, "POST", "/api/admin/boards/"+id+"/copy", "{}")
	if code != http.StatusCreated || cp["id"] == "" || cp["id"] == id || !strings.HasSuffix(cp["name"].(string), "(kopia)") {
		t.Fatalf("copy = %d %v", code, cp)
	}
	if c, err := e.app.st.Board(cp["id"].(string)); err != nil || c.OwnerID != userID(t, e, "bob-user") {
		t.Fatalf("the copy: %+v %v", c, err)
	}

	if code, _, _ := e.json(t, "DELETE", "/api/admin/boards/"+id, ""); code != http.StatusNoContent {
		t.Fatalf("delete = %d", code)
	}
	if _, err := e.app.st.Board(id); err == nil {
		t.Error("not deleted")
	}
	if code, _, _ := e.json(t, "DELETE", "/api/admin/boards/"+id, ""); code != http.StatusNotFound {
		t.Errorf("deleting again = %d", code)
	}
}

func TestTheReservedNameCannotBeRegistered(t *testing.T) {
	srv, _, _ := testApp(t)
	for _, name := range []string{"Administrator", "administrator", "Admin.istrator"} {
		resp := call(t, srv, "POST", "/api/register", `{"email":"x@example.com","username":"`+name+`","password":"password1","captcha":"ok"}`, nil)
		body := decode(t, resp)
		if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusConflict {
			t.Errorf("%s = %d %v", name, resp.StatusCode, body)
		}
	}
}

// Entering a board as the administrator: the page asks for a ticket, and a socket that shows it is
// listed as Administrator whatever name it gives; without one the name is refused.
func TestAdminEntersABoardAsTheAdministrator(t *testing.T) {
	e := devAdmin(t)
	owner := register(t, e.srv, "owner@example.com")
	id := createBoard(t, e.srv, owner, "Matma")

	code, body, _ := e.json(t, "POST", "/api/admin/boards/"+id+"/enter", "{}")
	url, _ := body["url"].(string)
	if code != http.StatusOK || !strings.HasPrefix(url, "/b/"+id+"?admin=") {
		t.Fatalf("enter = %d %v", code, body)
	}
	ticket := strings.TrimPrefix(url, "/b/"+id+"?admin=")
	if !e.app.validAdminTicket(id, ticket, time.Now()) {
		t.Fatal("the ticket is not valid")
	}
	if code, _, _ := e.json(t, "POST", "/api/admin/boards/nope/enter", "{}"); code != http.StatusNotFound {
		t.Errorf("a missing board = %d", code)
	}

	watcher := dialWith(t, e.srv, id, "id=w1&name=Ola")
	read(t, watcher) // snapshot
	read(t, watcher) // peers: Ola
	// clients that only say they are the Administrator (no ticket, a forged one) stay anonymous
	for _, q := range []string{"id=g1&name=Administrator", "id=f1&name=Administrator&admin=forged", "id=h1&name=Admin.istrator"} {
		read(t, dialWith(t, e.srv, id, q)) // snapshot only: nothing is listed for them
	}
	admin := dialWith(t, e.srv, id, "id=a1&name=Whatever&admin="+ticket)
	read(t, admin)
	m := read(t, watcher)
	peers, _ := m["peers"].([]any)
	if len(peers) != 2 || !peerNamed(t, m, "Administrator") || !peerNamed(t, m, "Ola") {
		t.Fatalf("the others should see Ola and the Administrator only, got %v", m)
	}
}

func peerNamed(t *testing.T, m map[string]any, name string) bool {
	t.Helper()
	peers, _ := m["peers"].([]any)
	for _, p := range peers {
		if p.(map[string]any)["name"] == name {
			return true
		}
	}
	return false
}
