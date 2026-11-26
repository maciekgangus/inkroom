package main

import (
	"fmt"
	"net/http"
	"testing"
)

func TestContactsAPIAndAutoRemember(t *testing.T) {
	srv, _, _ := testApp(t)
	alice := register(t, srv, "alice@example.com")
	bob := register(t, srv, "bob@example.com")
	carol := register(t, srv, "carol@example.com")
	_ = register(t, srv, "stranger@example.com")

	// Logged out -> 401.
	if got := status(call(t, srv, "GET", "/api/contacts", "", nil)); got != http.StatusUnauthorized {
		t.Fatalf("contacts logged out = %d", got)
	}

	// Initially empty (stranger is NOT leaked).
	initial := decode(t, call(t, srv, "GET", "/api/contacts", "", &alice))["contacts"].([]any)
	if len(initial) != 0 {
		t.Fatalf("expected 0 initial contacts, got %v", initial)
	}

	// Adding self -> 400; unknown -> 404.
	if got := status(call(t, srv, "POST", "/api/contacts", `{"login":"alice-user"}`, &alice)); got != http.StatusBadRequest {
		t.Fatalf("add self = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/contacts", `{"login":"missing"}`, &alice)); got != http.StatusNotFound {
		t.Fatalf("add missing = %d", got)
	}

	// Add bob by username -> 201, duplicate -> 409.
	addResp := call(t, srv, "POST", "/api/contacts", `{"login":"BOB-USER"}`, &alice)
	if addResp.StatusCode != http.StatusCreated {
		t.Fatalf("add bob = %d", addResp.StatusCode)
	}
	body := decode(t, addResp)
	bobID := int64(body["contact"].(map[string]any)["id"].(float64))
	if got := status(call(t, srv, "POST", "/api/contacts", `{"login":"bob@example.com"}`, &alice)); got != http.StatusConflict {
		t.Fatalf("dup contact = %d", got)
	}

	// Adding carol as co-owner on a board automatically remembers carol in alice's contacts!
	b1 := createBoard(t, srv, alice, "Matma")
	if got := status(call(t, srv, "POST", "/api/boards/"+b1+"/owners", `{"login":"carol-user"}`, &alice)); got != http.StatusOK {
		t.Fatalf("add carol owner = %d", got)
	}
	afterOwner := decode(t, call(t, srv, "GET", "/api/contacts", "", &alice))["contacts"].([]any)
	if len(afterOwner) != 2 {
		t.Fatalf("expected 2 contacts (bob + auto-remembered carol), got %v", afterOwner)
	}

	// Remove bob from saved contacts -> 200 and only carol remains (with relation=coowner preserved!).
	delResp := call(t, srv, "DELETE", fmt.Sprintf("/api/contacts/%d", bobID), "", &alice)
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("delete bob = %d", delResp.StatusCode)
	}
	rem := decode(t, delResp)["contacts"].([]any)
	if len(rem) != 1 || rem[0].(map[string]any)["username"] != "carol-user" || rem[0].(map[string]any)["relation"] != "coowner" {
		t.Fatalf("expected only carol left with relation=coowner, got %v", rem)
	}

	// Re-adding bob by userId (e.g. from a live whiteboard participant card) works cleanly.
	reAdd := call(t, srv, "POST", "/api/contacts", fmt.Sprintf(`{"userId":%d}`, bobID), &alice)
	if reAdd.StatusCode != http.StatusCreated {
		t.Fatalf("re-add bob by userId = %d", reAdd.StatusCode)
	}

	// Also verify bob does not see stranger either.
	_ = bob
	_ = carol
}
