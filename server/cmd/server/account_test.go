package main

import (
	"net/http"
	"testing"
)

func TestMeTellsWhetherTheAccountHasAPassword(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	u := register(t, srv, "ann@example.com")
	m := decode(t, call(t, srv, "GET", "/api/me", "", &u))
	if m["hasPassword"] != true {
		t.Fatalf("me = %v", m)
	}
}

func TestChangingThePassword(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	u := register(t, srv, "ann@example.com")
	if c := status(call(t, srv, "POST", "/api/account/password", `{"current":"wrong-one","new":"newpassword1"}`, &u)); c != http.StatusForbidden {
		t.Fatalf("wrong current = %d", c)
	}
	if c := status(call(t, srv, "POST", "/api/account/password", `{"current":"password1","new":"short"}`, &u)); c != http.StatusBadRequest {
		t.Fatalf("short new = %d", c)
	}
	if c := status(call(t, srv, "POST", "/api/account/password", `{"current":"password1","new":"newpassword1"}`, &u)); c != http.StatusNoContent {
		t.Fatalf("change = %d", c)
	}
	if c := status(call(t, srv, "POST", "/api/login", `{"login":"ann@example.com","password":"password1"}`, nil)); c != http.StatusUnauthorized {
		t.Fatalf("old password still works = %d", c)
	}
	if c := status(call(t, srv, "POST", "/api/login", `{"login":"ann@example.com","password":"newpassword1"}`, nil)); c != http.StatusOK {
		t.Fatalf("new password = %d", c)
	}
}

func TestAccountEndpointsNeedLogin(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	for _, p := range []string{"/api/account/password", "/api/account/delete"} {
		if c := status(call(t, srv, "POST", p, `{}`, nil)); c != http.StatusUnauthorized {
			t.Fatalf("%s = %d", p, c)
		}
	}
}

func TestDeletingTheAccountNeedsItsUsername(t *testing.T) {
	srv, _, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	u := register(t, srv, "ann@example.com")
	for _, body := range []string{`{}`, `{"confirm":"someone"}`} {
		if c := status(call(t, srv, "POST", "/api/account/delete", body, &u)); c != http.StatusBadRequest {
			t.Fatalf("%s = %d", body, c)
		}
	}
	if c := status(call(t, srv, "GET", "/api/me", "", &u)); c != http.StatusOK {
		t.Fatalf("account gone after a refused delete: %d", c)
	}
}

func TestDeletingTheAccountRemovesItAndItsBoards(t *testing.T) {
	srv, a, _ := startApp(t, t.TempDir()+"/t.db", t.TempDir())
	ann := register(t, srv, "ann@example.com")
	bob := register(t, srv, "bob@example.com")
	mine := createBoard(t, srv, ann, "Matma")
	theirs := createBoard(t, srv, bob, "Fizyka")
	if c := status(call(t, srv, "POST", "/api/account/delete", `{"confirm":"Ann-User"}`, &ann)); c != http.StatusNoContent {
		t.Fatalf("delete = %d", c)
	}
	if c := status(call(t, srv, "GET", "/api/me", "", &ann)); c != http.StatusUnauthorized {
		t.Fatalf("session survives: %d", c)
	}
	if _, err := a.st.Board(mine); err == nil {
		t.Fatal("board survives")
	}
	if _, err := a.st.Board(theirs); err != nil {
		t.Fatalf("someone else's board lost: %v", err)
	}
	if c := status(call(t, srv, "POST", "/api/login", `{"login":"ann@example.com","password":"password1"}`, nil)); c != http.StatusUnauthorized {
		t.Fatalf("login after delete = %d", c)
	}
}
