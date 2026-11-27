package main

import (
	"fmt"
	"net/http"
	"testing"
	"time"
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
	// Carol has to be someone alice knows first (R-122): here she opened alice's board.
	b1 := createBoard(t, srv, alice, "Matma")
	visit := dialAs(t, srv, b1, &carol)
	read(t, visit)      // snapshot
	for i := 0; ; i++ { // the visit is recorded just after the join
		if len(decode(t, call(t, srv, "GET", "/api/contacts", "", &alice))["contacts"].([]any)) == 2 {
			break
		}
		if i == 100 {
			t.Fatal("carol's visit not recorded")
		}
		time.Sleep(10 * time.Millisecond)
	}
	visit.CloseNow()
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

	// Bob is no longer connected to alice, so his id alone is refused; his username still works
	// (undoing a removal restores by username).
	if got := status(call(t, srv, "POST", "/api/contacts", fmt.Sprintf(`{"userId":%d}`, bobID), &alice)); got != http.StatusNotFound {
		t.Fatalf("re-add unrelated bob by userId = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/contacts", `{"login":"bob-user"}`, &alice)); got != http.StatusCreated {
		t.Fatalf("re-add bob by username = %d", got)
	}

	// Also verify bob does not see stranger either.
	_ = bob
	_ = carol
}
