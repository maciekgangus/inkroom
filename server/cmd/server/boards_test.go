package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

type user struct{ cookie *http.Cookie }

func register(t *testing.T, srv *httptest.Server, email string) user {
	t.Helper()
	resp := call(t, srv, "POST", "/api/register", `{"email":"`+email+`","username":"`+strings.Split(email, "@")[0]+`-user","password":"password1","captcha":"ok"}`, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register = %d", resp.StatusCode)
	}
	for _, c := range resp.Cookies() {
		if c.Name == "session" {
			return user{c}
		}
	}
	t.Fatal("no session cookie")
	return user{}
}

func call(t *testing.T, srv *httptest.Server, method, path, body string, u *user) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if u != nil {
		req.AddCookie(u.cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func decode(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("bad json %q: %v", b, err)
	}
	return m
}

func createBoard(t *testing.T, srv *httptest.Server, u user, name string) string {
	t.Helper()
	resp := call(t, srv, "POST", "/api/boards", `{"name":"`+name+`"}`, &u)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create board = %d", resp.StatusCode)
	}
	id, _ := decode(t, resp)["id"].(string)
	if len(id) != 32 {
		t.Fatalf("bad id %q", id)
	}
	return id
}

func status(resp *http.Response) int {
	resp.Body.Close()
	return resp.StatusCode
}

func TestCreatingABoardRequiresLogin(t *testing.T) {
	srv, _, _ := testApp(t)
	if got := status(call(t, srv, "POST", "/api/boards", `{"name":"x"}`, nil)); got != http.StatusUnauthorized {
		t.Fatalf("got %d", got)
	}
}

func TestBoardNameIsValidatedAndDefaulted(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	if got := status(call(t, srv, "POST", "/api/boards", `{"name":"`+strings.Repeat("x", 101)+`"}`, &u)); got != http.StatusBadRequest {
		t.Errorf("long name: got %d", got)
	}
	resp := call(t, srv, "POST", "/api/boards", `{}`, &u)
	if m := decode(t, resp); m["name"] != "Nowa tablica" {
		t.Errorf("default name: got %v", m)
	}
}

func TestBoardExistsEndpointNeedsNoLogin(t *testing.T) {
	srv, _, _ := testApp(t)
	id := createBoard(t, srv, register(t, srv, "a@example.com"), "Matma")
	resp := call(t, srv, "GET", "/api/boards/"+id, "", nil)
	if m := decode(t, resp); resp.StatusCode != 200 || m["name"] != "Matma" {
		t.Fatalf("got %d %v", resp.StatusCode, m)
	}
	if got := status(call(t, srv, "GET", "/api/boards/nope", "", nil)); got != http.StatusNotFound {
		t.Fatalf("unknown board: got %d", got)
	}
}

func TestListShowsOwnedBoards(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	createBoard(t, srv, u, "Matma")
	createBoard(t, srv, u, "Fizyka")
	createBoard(t, srv, other, "Cudza")

	m := decode(t, call(t, srv, "GET", "/api/boards", "", &u))
	owned := m["owned"].([]any)
	if len(owned) != 2 {
		t.Fatalf("got %v", m)
	}
	first := owned[0].(map[string]any)
	if first["id"] == nil || first["name"] == nil || first["updatedAt"] == nil {
		t.Fatalf("missing fields: %v", first)
	}
	if len(m["visited"].([]any)) != 0 {
		t.Fatalf("visited should be empty: %v", m)
	}
	if got := status(call(t, srv, "GET", "/api/boards", "", nil)); got != http.StatusUnauthorized {
		t.Fatalf("logged out: got %d", got)
	}
}

func TestOnlyTheOwnerCanRenameOrDelete(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	id := createBoard(t, srv, owner, "Matma")

	if got := status(call(t, srv, "PATCH", "/api/boards/"+id, `{"name":"Hack"}`, &other)); got != http.StatusForbidden {
		t.Errorf("rename by other: got %d", got)
	}
	if got := status(call(t, srv, "DELETE", "/api/boards/"+id, "", &other)); got != http.StatusForbidden {
		t.Errorf("delete by other: got %d", got)
	}
	if got := status(call(t, srv, "DELETE", "/api/boards/"+id, "", nil)); got != http.StatusUnauthorized {
		t.Errorf("delete by guest: got %d", got)
	}
	if got := status(call(t, srv, "PATCH", "/api/boards/"+id, `{"name":"Algebra"}`, &owner)); got != http.StatusNoContent {
		t.Errorf("rename by owner: got %d", got)
	}
	if m := decode(t, call(t, srv, "GET", "/api/boards/"+id, "", nil)); m["name"] != "Algebra" {
		t.Errorf("name not changed: %v", m)
	}
	if got := status(call(t, srv, "DELETE", "/api/boards/"+id, "", &owner)); got != http.StatusNoContent {
		t.Errorf("delete by owner: got %d", got)
	}
	if got := status(call(t, srv, "GET", "/api/boards/"+id, "", nil)); got != http.StatusNotFound {
		t.Errorf("deleted board: got %d", got)
	}
	if got := status(call(t, srv, "DELETE", "/api/boards/"+id, "", &owner)); got != http.StatusNotFound {
		t.Errorf("deleting twice: got %d", got)
	}
}

func TestOnlyTheOwnerCanSetTheBackground(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	id := createBoard(t, srv, owner, "Matma")
	path := "/api/boards/" + id + "/background"

	if got := status(call(t, srv, "PUT", path, `{"background":"grid"}`, &other)); got != http.StatusForbidden {
		t.Errorf("by other: got %d", got)
	}
	if got := status(call(t, srv, "PUT", path, `{"background":"grid"}`, nil)); got != http.StatusUnauthorized {
		t.Errorf("by guest: got %d", got)
	}
	if got := status(call(t, srv, "PUT", path, `{"background":"stars"}`, &owner)); got != http.StatusBadRequest {
		t.Errorf("unknown value: got %d", got)
	}

	ws := dial(t, srv, id)
	if m := read(t, ws); m["background"] != "plain" {
		t.Fatalf("snapshot: got %v", m)
	}
	if got := status(call(t, srv, "PUT", path, `{"background":"grid"}`, &owner)); got != http.StatusNoContent {
		t.Fatalf("by owner: got %d", got)
	}
	if m := read(t, ws); m["t"] != "background" || m["value"] != "grid" {
		t.Fatalf("live change: got %v", m)
	}
	if m := read(t, dial(t, srv, id)); m["background"] != "grid" {
		t.Fatalf("new joiner: got %v", m)
	}
}

func TestBoardEndpointTellsTheOwner(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	id := createBoard(t, srv, owner, "Matma")
	if m := decode(t, call(t, srv, "GET", "/api/boards/"+id, "", &owner)); m["owner"] != true {
		t.Errorf("owner: got %v", m)
	}
	if m := decode(t, call(t, srv, "GET", "/api/boards/"+id, "", &other)); m["owner"] != false {
		t.Errorf("other: got %v", m)
	}
	if m := decode(t, call(t, srv, "GET", "/api/boards/"+id, "", nil)); m["owner"] != false {
		t.Errorf("guest: got %v", m)
	}
}

func TestTheViewIsSavedPerUser(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	id := createBoard(t, srv, owner, "Matma")
	path := "/api/boards/" + id + "/view"
	if got := status(call(t, srv, "GET", path, "", nil)); got != http.StatusUnauthorized {
		t.Errorf("logged out: got %d", got)
	}
	if got := status(call(t, srv, "GET", path, "", &owner)); got != http.StatusNoContent {
		t.Errorf("nothing saved: got %d", got)
	}
	if got := status(call(t, srv, "PUT", path, `{"x":120.5,"y":-40,"scale":2}`, &owner)); got != http.StatusNoContent {
		t.Fatalf("save: got %d", got)
	}
	m := decode(t, call(t, srv, "GET", path, "", &owner))
	if m["x"] != 120.5 || m["y"] != -40.0 || m["scale"] != 2.0 {
		t.Errorf("got %v", m)
	}
	// A visitor keeps a view of their own, and the owner's is not theirs.
	if got := status(call(t, srv, "GET", path, "", &other)); got != http.StatusNoContent {
		t.Errorf("another user: got %d", got)
	}
	if got := status(call(t, srv, "PUT", path, `{"x":1,"y":2,"scale":0.5}`, &other)); got != http.StatusNoContent {
		t.Errorf("visitor save: got %d", got)
	}
	// Nonsense is refused: a scale outside what the board allows, and NaN-like numbers.
	for _, body := range []string{`{"x":1,"y":2,"scale":0}`, `{"x":1,"y":2,"scale":99}`, `{"x":1e300,"y":2,"scale":1}`, `{"x":"a"}`} {
		if got := status(call(t, srv, "PUT", path, body, &owner)); got != http.StatusBadRequest {
			t.Errorf("%s: got %d", body, got)
		}
	}
	if got := status(call(t, srv, "PUT", "/api/boards/ghost/view", `{"x":1,"y":2,"scale":1}`, &owner)); got != http.StatusNotFound {
		t.Errorf("no such board: got %d", got)
	}
}

func TestOwnerCopiesABoardWithItsDrawingsAndPictures(t *testing.T) {
	srv, a, _ := testApp(t)
	st := a.st
	owner := register(t, srv, "a@example.com")
	id := createBoard(t, srv, owner, "Matma")
	img := uploadOK(t, srv, id, tinyPNG)
	if err := st.Apply(id, []store.Op{{Add: true, ID: "s1", Data: []byte(`{"id":"s1","kind":"image","src":"` + img + `","points":[[0,0,0.5],[5,5,0.5]]}`)}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	resp := call(t, srv, "POST", "/api/boards/"+id+"/copy", "", &owner)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("copy = %d", resp.StatusCode)
	}
	out := decode(t, resp)
	newID, _ := out["id"].(string)
	if len(newID) != 32 || newID == id || out["name"] != "Matma (kopia)" {
		t.Fatalf("copy = %v", out)
	}
	strokes, _ := st.LoadStrokes(newID)
	if len(strokes) != 1 || strings.Contains(string(strokes[0]), img) {
		t.Fatalf("copied strokes = %q", strokes)
	}
	// It is the copier's board, with its own link, listed in their panel.
	list := decode(t, call(t, srv, "GET", "/api/boards", "", &owner))
	if len(list["owned"].([]any)) != 2 {
		t.Fatalf("owned = %v", list["owned"])
	}
}

func TestOnlyTheOwnerCanCopyABoard(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	id := createBoard(t, srv, owner, "Matma")
	if r := call(t, srv, "POST", "/api/boards/"+id+"/copy", "", &other); r.StatusCode != http.StatusForbidden {
		t.Fatalf("another user = %d, want 403", r.StatusCode)
	}
	if r := call(t, srv, "POST", "/api/boards/"+id+"/copy", "", nil); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a guest = %d, want 401", r.StatusCode)
	}
	if r := call(t, srv, "POST", "/api/boards/ffffffffffffffffffffffffffffffff/copy", "", &owner); r.StatusCode != http.StatusNotFound {
		t.Fatalf("missing board = %d, want 404", r.StatusCode)
	}
}

func TestACopyIncludesWhatWasNotYetSavedToTheDatabase(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	id := createBoard(t, srv, owner, "Matma")
	ws := dial(t, srv, id)
	read(t, ws) // snapshot
	write(t, ws, `{"t":"add","stroke":{"id":"s9","authorId":"x","color":"#111","size":4,"z":1,"points":[[1,1,0.5]]}}`)
	read(t, ws) // echo: the room has it, the database may not yet
	newID, _ := decode(t, call(t, srv, "POST", "/api/boards/"+id+"/copy", "", &owner))["id"].(string)
	cp := dial(t, srv, newID)
	if m := read(t, cp); m["t"] != "snapshot" || len(m["strokes"].([]any)) != 1 {
		t.Fatalf("the copy misses a fresh stroke: %v", m)
	}
}

// listed returns the boards of one list ("owned" or "visited") of a user.
func listed(t *testing.T, srv *httptest.Server, u user, which string) []map[string]any {
	t.Helper()
	m := decode(t, call(t, srv, "GET", "/api/boards", "", &u))
	var out []map[string]any
	for _, b := range m[which].([]any) {
		out = append(out, b.(map[string]any))
	}
	return out
}

// visit joins a board over its WebSocket as the user, so the server records the visit.
func visit(t *testing.T, srv *httptest.Server, id string, u user) {
	t.Helper()
	c := dialAs(t, srv, id, &u)
	read(t, c)
	deadline := time.Now().Add(2 * time.Second)
	for len(listed(t, srv, u, "visited")) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the visit was never recorded")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestVisitedBoardsSayWhoseTheyAreAndOwnedOnesDoNot(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "anna@example.com") // username "anna-user"
	student := register(t, srv, "student@example.com")
	id := createBoard(t, srv, owner, "Matma")
	visit(t, srv, id, student)

	v := listed(t, srv, student, "visited")
	if len(v) != 1 || v[0]["owner"] != "anna-user" {
		t.Fatalf("visited = %v", v)
	}
	if o := listed(t, srv, owner, "owned"); len(o) != 1 || o[0]["owner"] != nil {
		t.Fatalf("an owned board should carry no owner: %v", o)
	}
	for _, b := range v {
		for _, val := range b {
			if s, _ := val.(string); strings.Contains(s, "@") {
				t.Fatalf("an e-mail leaked into the list: %v", b)
			}
		}
	}
}

func TestAGuestCanDropABoardFromTheirListAndOpeningItAgainBringsItBack(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "anna@example.com")
	student := register(t, srv, "student@example.com")
	id := createBoard(t, srv, owner, "Matma")
	visit(t, srv, id, student)

	resp := call(t, srv, "DELETE", "/api/boards/"+id+"/visit", "", &student)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	if v := listed(t, srv, student, "visited"); len(v) != 0 {
		t.Fatalf("still listed: %v", v)
	}
	if o := listed(t, srv, owner, "owned"); len(o) != 1 {
		t.Fatalf("the owner's board is gone: %v", o)
	}
	if r := call(t, srv, "GET", "/api/boards/"+id, "", nil); r.StatusCode != http.StatusOK {
		t.Fatalf("the board's link stopped working: %d", r.StatusCode)
	}
	visit(t, srv, id, student) // back
}

func TestDroppingFromTheListNeedsAnAccountAndNeverDeletesAnOwnBoard(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "anna@example.com")
	id := createBoard(t, srv, owner, "Matma")
	if r := call(t, srv, "DELETE", "/api/boards/"+id+"/visit", "", nil); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("logged out = %d, want 401", r.StatusCode)
	}
	if r := call(t, srv, "DELETE", "/api/boards/"+id+"/visit", "", &owner); r.StatusCode != http.StatusNoContent {
		t.Fatalf("the owner = %d", r.StatusCode)
	}
	if o := listed(t, srv, owner, "owned"); len(o) != 1 {
		t.Fatalf("the owner's own board vanished: %v", o)
	}
}
