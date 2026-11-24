package store

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestBoardQuotaIsEnforced(t *testing.T) {
	st := openTest(t)
	old := MaxBoardBytes
	MaxBoardBytes = 100
	defer func() { MaxBoardBytes = old }()

	u, err := st.CreateUser("q@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	b, err := st.CreateBoard("b1", u.ID, "Q")
	if err != nil {
		t.Fatal(err)
	}
	// 60 bytes of strokes fit, 60 more do not.
	ops := []Op{{Add: true, ID: "s1", Data: make([]byte, 60)}}
	if err := st.Apply(b.ID, ops, time.Now()); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	ops = []Op{{Add: true, ID: "s2", Data: make([]byte, 60)}}
	if err := st.Apply(b.ID, ops, time.Now()); !errors.Is(err, ErrQuota) {
		t.Fatalf("second apply should hit the quota, got %v", err)
	}
	if err := st.SaveImage("i1", b.ID, "image/png", make([]byte, 60)); !errors.Is(err, ErrQuota) {
		t.Fatalf("image over quota should be refused, got %v", err)
	}
	// Removing frees room again.
	if err := st.Apply(b.ID, []Op{{ID: "s1"}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := st.Apply(b.ID, []Op{{Add: true, ID: "s2", Data: make([]byte, 60)}}, time.Now()); err != nil {
		t.Fatalf("apply after remove: %v", err)
	}
}

func TestDeleteOtherSessionsKeepsOne(t *testing.T) {
	st := openTest(t)
	u, err := st.CreateUser("s@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, tok := range []string{"aaa", "bbb", "ccc"} {
		if err := st.CreateSession(tok, u.ID, now.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.DeleteOtherSessions(u.ID, "bbb"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SessionUser("bbb", now); err != nil {
		t.Fatal("the kept session should survive")
	}
	for _, tok := range []string{"aaa", "ccc"} {
		if _, err := st.SessionUser(tok, now); !errors.Is(err, ErrNotFound) {
			t.Fatalf("session %s should be gone, got %v", tok, err)
		}
	}
}
