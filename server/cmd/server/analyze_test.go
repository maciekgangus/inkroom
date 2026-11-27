package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOnlyTheOwnerAnalyzesABoard(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"boardId":"x","model":"m","count":1,"segments":[{"id":"s1","elementIds":["e1"],"bbox":{"minX":0,"minY":0,"maxX":1,"maxY":1},"latex":"x"}]}`)
	}))
	defer fake.Close()
	srv, a, _ := testApp(t)
	a.ai.SetURL(fake.URL)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	id := createBoard(t, srv, owner, "Matma")
	path := "/api/boards/" + id + "/analyze"

	for _, method := range []string{"POST", "GET"} {
		if got := status(call(t, srv, method, path, "", nil)); got != http.StatusUnauthorized {
			t.Errorf("%s by guest: got %d", method, got)
		}
		if got := status(call(t, srv, method, path, "", &other)); got != http.StatusForbidden {
			t.Errorf("%s by other: got %d", method, got)
		}
		if got := status(call(t, srv, method, "/api/boards/nope/analyze", "", &owner)); got != http.StatusNotFound {
			t.Errorf("%s of a missing board: got %d", method, got)
		}
	}

	if got := status(call(t, srv, "POST", path, "", &owner)); got != http.StatusAccepted {
		t.Fatalf("POST by owner: got %d", got)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		m := decode(t, call(t, srv, "GET", path, "", &owner))
		if m["status"] == "done" {
			if segs, _ := m["segments"].([]any); len(segs) != 1 {
				t.Fatalf("segments: %v", m)
			}
			break
		}
		if m["status"] != "running" || time.Now().After(deadline) {
			t.Fatalf("GET by owner: %v", m)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
