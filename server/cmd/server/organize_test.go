package main

import (
	"net/http"
	"testing"
)

func TestFoldersAndMarkersAPI(t *testing.T) {
	srv, _, _ := testApp(t)
	u1 := register(t, srv, "tutor@example.com")
	u2 := register(t, srv, "student@example.com")

	// Logged out cannot create folders or markers.
	if got := status(call(t, srv, "POST", "/api/folders", `{"name":"Matma"}`, nil)); got != http.StatusUnauthorized {
		t.Fatalf("folder logged out = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/markers", `{"name":"Pilne"}`, nil)); got != http.StatusUnauthorized {
		t.Fatalf("marker logged out = %d", got)
	}

	// Bad color is rejected.
	if got := status(call(t, srv, "POST", "/api/folders", `{"name":"Matma","color":"neon"}`, &u1)); got != http.StatusBadRequest {
		t.Fatalf("bad color = %d", got)
	}

	// Create folder & marker.
	fResp := call(t, srv, "POST", "/api/folders", `{"name":"Matematyka","color":"indigo"}`, &u1)
	if fResp.StatusCode != http.StatusCreated {
		t.Fatalf("create folder = %d", fResp.StatusCode)
	}
	folderID := decode(t, fResp)["id"].(string)

	// Duplicate folder returns 409.
	if got := status(call(t, srv, "POST", "/api/folders", `{"name":"matematyka"}`, &u1)); got != http.StatusConflict {
		t.Fatalf("dup folder = %d", got)
	}

	mResp := call(t, srv, "POST", "/api/markers", `{"name":"Matura","color":"rose"}`, &u1)
	if mResp.StatusCode != http.StatusCreated {
		t.Fatalf("create marker = %d", mResp.StatusCode)
	}
	markerID := decode(t, mResp)["id"].(string)

	// Create board directly inside the folder.
	bResp := call(t, srv, "POST", "/api/boards", `{"name":"Funkcje","folderId":"`+folderID+`"}`, &u1)
	if bResp.StatusCode != http.StatusCreated {
		t.Fatalf("create board in folder = %d", bResp.StatusCode)
	}
	b1 := decode(t, bResp)["id"].(string)
	b2 := createBoard(t, srv, u1, "Geometria")

	// Update meta: pin + attach marker.
	if got := status(call(t, srv, "PATCH", "/api/boards/"+b1+"/meta", `{"pinned":true,"markerIds":["`+markerID+`"]}`, &u1)); got != http.StatusNoContent {
		t.Fatalf("update meta = %d", got)
	}

	// User 2 cannot edit u1's folder or use u1's folder on their board.
	if got := status(call(t, srv, "PATCH", "/api/folders/"+folderID, `{"name":"Hack"}`, &u2)); got != http.StatusNotFound {
		t.Fatalf("foreign folder patch = %d", got)
	}
	if got := status(call(t, srv, "PATCH", "/api/boards/"+b1+"/meta", `{"folderId":"`+folderID+`"}`, &u2)); got != http.StatusNotFound {
		t.Fatalf("foreign folder assign = %d", got)
	}

	// Bulk organize moves b2 into folder and adds marker.
	if got := status(call(t, srv, "POST", "/api/boards/organize", `{"boardIds":["`+b2+`"],"folderId":"`+folderID+`","addMarkerIds":["`+markerID+`"]}`, &u1)); got != http.StatusNoContent {
		t.Fatalf("bulk organize = %d", got)
	}

	// Save custom order: b2 first, then b1.
	if got := status(call(t, srv, "PUT", "/api/boards/order", `{"boardIds":["`+b2+`","`+b1+`"]}`, &u1)); got != http.StatusNoContent {
		t.Fatalf("order = %d", got)
	}

	// GET /api/boards returns folders, markers, and enriched board metadata.
	list := decode(t, call(t, srv, "GET", "/api/boards", "", &u1))
	folders := list["folders"].([]any)
	markers := list["markers"].([]any)
	if len(folders) != 1 || len(markers) != 1 {
		t.Fatalf("folders=%v markers=%v", folders, markers)
	}
	byID := map[string]map[string]any{}
	for _, raw := range list["owned"].([]any) {
		m := raw.(map[string]any)
		byID[m["id"].(string)] = m
	}
	if byID[b1]["folderId"] != folderID || byID[b1]["pinned"] != true || byID[b1]["position"].(float64) != 2 {
		t.Fatalf("b1 meta = %v", byID[b1])
	}
	if byID[b2]["folderId"] != folderID || byID[b2]["position"].(float64) != 1 {
		t.Fatalf("b2 meta = %v", byID[b2])
	}

	// Rename folder, then delete folder and marker.
	up := decode(t, call(t, srv, "PATCH", "/api/folders/"+folderID, `{"name":"Matma 2026","color":"emerald"}`, &u1))
	if up["name"] != "Matma 2026" || up["color"] != "emerald" {
		t.Fatalf("updated folder = %v", up)
	}
	if got := status(call(t, srv, "DELETE", "/api/folders/"+folderID, "", &u1)); got != http.StatusNoContent {
		t.Fatalf("delete folder = %d", got)
	}
	if got := status(call(t, srv, "DELETE", "/api/markers/"+markerID, "", &u1)); got != http.StatusNoContent {
		t.Fatalf("delete marker = %d", got)
	}
	after := decode(t, call(t, srv, "GET", "/api/boards", "", &u1))
	if len(after["folders"].([]any)) != 0 || len(after["markers"].([]any)) != 0 {
		t.Fatalf("after delete = %v", after)
	}
}
