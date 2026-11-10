package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type user struct{ cookie *http.Cookie }

func register(t *testing.T, srv *httptest.Server, email string) user {
	t.Helper()
	resp := call(t, srv, "POST", "/api/register", `{"email":"`+email+`","password":"password1"}`, nil)
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
