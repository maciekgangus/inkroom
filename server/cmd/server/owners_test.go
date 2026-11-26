package main

import (
	"fmt"
	"net/http"
	"testing"
)

func TestBoardOwnersAndTransferAPI(t *testing.T) {
	srv, _, _ := testApp(t)
	alice := register(t, srv, "alice@example.com")
	bob := register(t, srv, "bob@example.com")
	carol := register(t, srv, "carol@example.com")

	b1 := createBoard(t, srv, alice, "Algebra")
	b2 := createBoard(t, srv, alice, "Fizyka")

	// Logged out and non-owner cannot view or change owners.
	if got := status(call(t, srv, "GET", "/api/boards/"+b1+"/owners", "", nil)); got != http.StatusUnauthorized {
		t.Fatalf("owners logged out = %d", got)
	}
	if got := status(call(t, srv, "GET", "/api/boards/"+b1+"/owners", "", &bob)); got != http.StatusForbidden {
		t.Fatalf("owners non-owner = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/boards/"+b1+"/owners", `{"login":"carol"}`, &bob)); got != http.StatusForbidden {
		t.Fatalf("add owner non-owner = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/boards/"+b1+"/transfer", `{"login":"carol"}`, &bob)); got != http.StatusForbidden {
		t.Fatalf("transfer non-owner = %d", got)
	}

	// Unknown user -> 404.
	if got := status(call(t, srv, "POST", "/api/boards/"+b1+"/owners", `{"login":"nobody"}`, &alice)); got != http.StatusNotFound {
		t.Fatalf("unknown co-owner = %d", got)
	}

	// Alice adds Bob as co-owner by username (case-insensitive).
	addResp := call(t, srv, "POST", "/api/boards/"+b1+"/owners", `{"login":"BOB-USER"}`, &alice)
	if addResp.StatusCode != http.StatusOK {
		t.Fatalf("add bob = %d", addResp.StatusCode)
	}
	ownersList := decode(t, addResp)["owners"].([]any)
	if len(ownersList) != 2 {
		t.Fatalf("expected 2 owners, got %v", ownersList)
	}
	aliceID := int64(ownersList[0].(map[string]any)["id"].(float64))
	bobID := int64(ownersList[1].(map[string]any)["id"].(float64))

	// Duplicate add -> 409.
	if got := status(call(t, srv, "POST", "/api/boards/"+b1+"/owners", `{"login":"bob@example.com"}`, &alice)); got != http.StatusConflict {
		t.Fatalf("duplicate co-owner = %d", got)
	}

	// Bob is now an equal owner: GET /api/boards/{id} reports owner: true, rename & background work.
	infoResp := call(t, srv, "GET", "/api/boards/"+b1, "", &bob)
	if got := decode(t, infoResp)["owner"]; got != true {
		t.Fatalf("expected owner=true for co-owner bob, got %v", got)
	}
	if got := status(call(t, srv, "PATCH", "/api/boards/"+b1, `{"name":"Algebra 2"}`, &bob)); got != http.StatusNoContent {
		t.Fatalf("co-owner rename = %d", got)
	}
	if got := status(call(t, srv, "PUT", "/api/boards/"+b1+"/background", `{"background":"grid"}`, &bob)); got != http.StatusNoContent {
		t.Fatalf("co-owner background = %d", got)
	}

	// Both Alice and Bob see b1 in owned with owners metadata.
	bobList := decode(t, call(t, srv, "GET", "/api/boards", "", &bob))
	bobOwned := bobList["owned"].([]any)
	if len(bobOwned) != 1 {
		t.Fatalf("expected bob to have 1 owned board, got %v", bobOwned)
	}
	boardOwners := bobOwned[0].(map[string]any)["owners"].([]any)
	if len(boardOwners) != 2 {
		t.Fatalf("expected 2 owners on board JSON, got %v", boardOwners)
	}

	// Co-owner copy creates a board solely owned by Bob (not Alice).
	copyResp := call(t, srv, "POST", "/api/boards/"+b1+"/copy", `{}`, &bob)
	if copyResp.StatusCode != http.StatusCreated {
		t.Fatalf("co-owner copy = %d", copyResp.StatusCode)
	}
	copyID := decode(t, copyResp)["id"].(string)
	if got := decode(t, call(t, srv, "GET", "/api/boards/"+copyID, "", &alice))["owner"]; got != false {
		t.Fatalf("expected bob's copy not to be owned by alice, got %v", got)
	}

	// Alice leaves b1 -> Bob remains sole owner; Alice moves to visited.
	delResp := call(t, srv, "DELETE", fmt.Sprintf("/api/boards/%s/owners/%d", b1, aliceID), "", &alice)
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("alice leave = %d", delResp.StatusCode)
	}
	if decode(t, delResp)["selfRemoved"] != true {
		t.Fatalf("expected selfRemoved=true")
	}
	// Bob cannot remove himself as last owner.
	if got := status(call(t, srv, "DELETE", fmt.Sprintf("/api/boards/%s/owners/%d", b1, bobID), "", &bob)); got != http.StatusBadRequest {
		t.Fatalf("remove last owner = %d", got)
	}

	// Alice now sees b1 under visited (not owned).
	aliceBoards := decode(t, call(t, srv, "GET", "/api/boards", "", &alice))
	if len(aliceBoards["visited"].([]any)) != 1 {
		t.Fatalf("expected alice to see b1 in visited after leaving, got %v", aliceBoards["visited"])
	}

	// Bob transfers b1 to Carol ("przerzucanie na innego ziomka").
	trResp := call(t, srv, "POST", "/api/boards/"+b1+"/transfer", `{"login":"carol-user"}`, &bob)
	if trResp.StatusCode != http.StatusOK {
		t.Fatalf("transfer b1 to carol = %d", trResp.StatusCode)
	}
	if got := decode(t, call(t, srv, "GET", "/api/boards/"+b1, "", &carol))["owner"]; got != true {
		t.Fatalf("expected carol to own b1 after transfer")
	}
	if got := status(call(t, srv, "PATCH", "/api/boards/"+b1, `{"name":"Nope"}`, &bob)); got != http.StatusForbidden {
		t.Fatalf("expected bob forbidden after transfer, got %d", got)
	}
	bobAfter := decode(t, call(t, srv, "GET", "/api/boards", "", &bob))
	if len(bobAfter["visited"].([]any)) != 1 {
		t.Fatalf("expected bob to keep b1 in visited after transfer, got %v", bobAfter["visited"])
	}

	// Bulk transfer: Alice tries to transfer [b1, b2] (doesn't own b1) -> 403.
	if got := status(call(t, srv, "POST", "/api/boards/transfer", fmt.Sprintf(`{"boardIds":[%q,%q],"login":"carol-user"}`, b1, b2), &alice)); got != http.StatusForbidden {
		t.Fatalf("bulk transfer unowned = %d", got)
	}
	// Bulk transfer [b2] by Alice to Carol succeeds.
	bulkResp := call(t, srv, "POST", "/api/boards/transfer", fmt.Sprintf(`{"boardIds":[%q],"login":"carol-user"}`, b2), &alice)
	if bulkResp.StatusCode != http.StatusOK {
		t.Fatalf("bulk transfer b2 = %d", bulkResp.StatusCode)
	}
	if got := decode(t, call(t, srv, "GET", "/api/boards/"+b2, "", &carol))["owner"]; got != true {
		t.Fatalf("expected carol to own b2 after bulk transfer")
	}

	// Deleting one co-owner's account preserves co-owned board for the remaining owner!
	shared := createBoard(t, srv, alice, "Wspólna przed usunięciem")
	if got := status(call(t, srv, "POST", "/api/boards/"+shared+"/owners", `{"login":"carol-user"}`, &alice)); got != http.StatusOK {
		t.Fatalf("add carol to shared = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/account/delete", `{"confirm":"alice-user"}`, &alice)); got != http.StatusNoContent {
		t.Fatalf("delete alice = %d", got)
	}
	if got := decode(t, call(t, srv, "GET", "/api/boards/"+shared, "", &carol))["owner"]; got != true {
		t.Fatalf("expected shared board to survive alice's account deletion under carol")
	}
}
