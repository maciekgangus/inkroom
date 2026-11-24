package room

import (
	"strings"
	"testing"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

func TestBoardFullRejectsNewStrokes(t *testing.T) {
	old := store.MaxBoardBytes
	store.MaxBoardBytes = 150 // a 5-point stroke raw is 86 bytes
	defer func() { store.MaxBoardBytes = old }()

	stroke := func(id string, points int) []byte {
		return []byte(`{"t":"add","stroke":{"id":"` + id + `","points":[` + strings.Repeat("[1,1,0.5],", points) + `[1,1,0.5]]}}`)
	}

	r := New()
	c := join(r)
	recv(t, c)            // the snapshot
	s1 := stroke("s1", 5) // 110 bytes
	if err := r.Handle(c, s1); err != nil {
		t.Fatal(err)
	}
	recv(t, c)
	// 86 + 86 > 150: refused.
	if err := r.Handle(c, stroke("s2", 5)); err != errBoardFull {
		t.Fatalf("expected errBoardFull, got %v", err)
	}
	// Removing frees room again.
	if err := r.Handle(c, []byte(`{"t":"remove","id":"s1"}`)); err != nil {
		t.Fatal(err)
	}
	recv(t, c)
	if err := r.Handle(c, stroke("s2", 5)); err != nil {
		t.Fatalf("add after remove: %v", err)
	}
}
