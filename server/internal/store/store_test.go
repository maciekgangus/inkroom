package store

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func user(t *testing.T, s *Store, email string) User {
	t.Helper()
	u, err := s.CreateUser(email, "hash")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestUsers(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if u.ID == 0 || u.Email != "a@example.com" {
		t.Fatalf("got %+v", u)
	}
	if _, err := s.CreateUser("a@example.com", "x"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("duplicate: got %v", err)
	}
	got, err := s.UserByEmail("a@example.com")
	if err != nil || got.ID != u.ID || got.Hash != "hash" {
		t.Fatalf("got %+v %v", got, err)
	}
	if _, err := s.UserByEmail("nobody@example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestSessions(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	now := time.Now()
	if err := s.CreateSession("tok", u.ID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	got, err := s.SessionUser("tok", now)
	if err != nil || got.ID != u.ID {
		t.Fatalf("got %+v %v", got, err)
	}
	if _, err := s.SessionUser("tok", now.Add(2*time.Hour)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session: got %v", err)
	}
	if err := s.ExtendSession("tok", now.Add(10*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SessionUser("tok", now.Add(2*time.Hour)); err != nil {
		t.Fatalf("extended session: %v", err)
	}
	if err := s.DeleteSession("tok"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SessionUser("tok", now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted session: got %v", err)
	}
}

func TestBoardsOwnedAndVisited(t *testing.T) {
	s := open(t)
	owner := user(t, s, "owner@example.com")
	guest := user(t, s, "guest@example.com")
	if _, err := s.CreateBoard("b1", owner.ID, "Matma"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateBoard("b2", owner.ID, "Fizyka"); err != nil {
		t.Fatal(err)
	}
	b, err := s.Board("b1")
	if err != nil || b.Name != "Matma" || b.OwnerID != owner.ID {
		t.Fatalf("got %+v %v", b, err)
	}
	if _, err := s.Board("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
	if err := s.RenameBoard("b1", "Matematyka"); err != nil {
		t.Fatal(err)
	}

	owned, err := s.BoardsOwnedBy(owner.ID)
	if err != nil || len(owned) != 2 {
		t.Fatalf("got %+v %v", owned, err)
	}

	// Visits: recorded for other people's boards, never for one's own.
	now := time.Now()
	if err := s.RecordVisit(guest.ID, "b1", now); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordVisit(guest.ID, "b1", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordVisit(owner.ID, "b2", now); err != nil {
		t.Fatal(err)
	}
	visited, err := s.BoardsVisitedBy(guest.ID)
	if err != nil || len(visited) != 1 || visited[0].ID != "b1" || visited[0].Name != "Matematyka" {
		t.Fatalf("got %+v %v", visited, err)
	}
	if v, _ := s.BoardsVisitedBy(owner.ID); len(v) != 0 {
		t.Fatalf("owner should not see own board as visited: %+v", v)
	}
}

func TestStrokesApplyAndLoad(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if _, err := s.CreateBoard("b1", u.ID, "x"); err != nil {
		t.Fatal(err)
	}
	err := s.Apply("b1", []Op{
		{Add: true, ID: "s1", Data: []byte(`{"id":"s1"}`)},
		{Add: true, ID: "s2", Data: []byte(`{"id":"s2"}`)},
		{Add: true, ID: "s1", Data: []byte(`{"id":"s1"}`)}, // idempotent
		{Add: false, ID: "s2"},
		{Add: false, ID: "unknown"},
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadStrokes("b1")
	if err != nil || len(got) != 1 || string(got[0]) != `{"id":"s1"}` {
		t.Fatalf("got %q %v", got, err)
	}
}

func TestApplyTouchesUpdatedAt(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	b, _ := s.CreateBoard("b1", u.ID, "x")
	later := b.UpdatedAt.Add(time.Hour)
	if err := s.Apply("b1", []Op{{Add: true, ID: "s1", Data: []byte(`{}`)}}, later); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Board("b1")
	if !got.UpdatedAt.Equal(later.Truncate(time.Second)) {
		t.Fatalf("updated_at = %v, want %v", got.UpdatedAt, later)
	}
}

func TestDeleteBoardRemovesEverything(t *testing.T) {
	s := open(t)
	owner := user(t, s, "o@example.com")
	guest := user(t, s, "g@example.com")
	_, _ = s.CreateBoard("b1", owner.ID, "x")
	_ = s.Apply("b1", []Op{{Add: true, ID: "s1", Data: []byte(`{}`)}}, time.Now())
	_ = s.RecordVisit(guest.ID, "b1", time.Now())
	if err := s.DeleteBoard("b1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Board("b1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
	if got, _ := s.LoadStrokes("b1"); len(got) != 0 {
		t.Fatalf("strokes left: %q", got)
	}
	if v, _ := s.BoardsVisitedBy(guest.ID); len(v) != 0 {
		t.Fatalf("visit left: %+v", v)
	}
}

func TestDataSurvivesReopening(t *testing.T) {
	path := filepath.Join(t.TempDir(), "p.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := s.CreateUser("a@example.com", "h")
	_, _ = s.CreateBoard("b1", u.ID, "x")
	_ = s.Apply("b1", []Op{{Add: true, ID: "s1", Data: []byte(`{"id":"s1"}`)}}, time.Now())
	s.Close()

	s2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if got, _ := s2.LoadStrokes("b1"); len(got) != 1 {
		t.Fatalf("got %q", got)
	}
}

func TestBoardBackground(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if _, err := s.CreateBoard("b1", u.ID, "Matma"); err != nil {
		t.Fatal(err)
	}
	if bg, err := s.LoadBackground("b1"); err != nil || bg != "plain" {
		t.Fatalf("default: got %q, %v", bg, err)
	}
	if err := s.SetBoardBackground("b1", "grid"); err != nil {
		t.Fatal(err)
	}
	if b, err := s.Board("b1"); err != nil || b.Background != "grid" {
		t.Fatalf("got %+v, %v", b, err)
	}
	if err := s.SetBoardBackground("nope", "grid"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown board: got %v", err)
	}
	if !ValidBackground("dots") || !ValidBackground("lines") || ValidBackground("") || ValidBackground("url(x)") {
		t.Fatal("ValidBackground accepts the wrong values")
	}
}

func TestImages(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	_, _ = s.CreateBoard("b1", u.ID, "x")
	_, _ = s.CreateBoard("b2", u.ID, "y")

	if err := s.SaveImage("img1", "b1", "image/png", []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	mime, data, err := s.Image("b1", "img1")
	if err != nil || mime != "image/png" || string(data) != "\x01\x02\x03" {
		t.Fatalf("got %q %v %v", mime, data, err)
	}
	if _, _, err := s.Image("b2", "img1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an image must only be readable through its own board: %v", err)
	}
	if _, _, err := s.Image("b1", "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}

func TestSaveImageNeedsAnExistingBoard(t *testing.T) {
	s := open(t)
	if err := s.SaveImage("img1", "no-such-board", "image/png", []byte{1}); err == nil {
		t.Fatal("expected an error")
	}
}

func TestDeletingABoardDeletesItsImages(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	_, _ = s.CreateBoard("b1", u.ID, "x")
	_ = s.SaveImage("img1", "b1", "image/png", []byte{1})
	if err := s.DeleteBoard("b1"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Image("b1", "img1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("image survived its board: %v", err)
	}
}

func TestApplyReplaceChangesAnExistingStrokeOnly(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	_, _ = s.CreateBoard("b1", u.ID, "x")
	err := s.Apply("b1", []Op{
		{Add: true, ID: "s1", Data: []byte(`{"id":"s1","v":1}`)},
		{Add: true, ID: "s2", Data: []byte(`{"id":"s2","v":1}`)},
		{Replace: true, ID: "s1", Data: []byte(`{"id":"s1","v":2}`)},
		{Replace: true, ID: "ghost", Data: []byte(`{"id":"ghost"}`)}, // never inserted
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.LoadStrokes("b1")
	if len(got) != 2 || string(got[0]) != `{"id":"s1","v":2}` || string(got[1]) != `{"id":"s2","v":1}` {
		t.Fatalf("got %q", got)
	}
}

func TestAddDoesNotOverwriteAnExistingStroke(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	_, _ = s.CreateBoard("b1", u.ID, "x")
	_ = s.Apply("b1", []Op{
		{Add: true, ID: "s1", Data: []byte(`{"id":"s1","v":2}`)},
		{Add: true, ID: "s1", Data: []byte(`{"id":"s1","v":1}`)}, // a stale resend
	}, time.Now())
	got, _ := s.LoadStrokes("b1")
	if len(got) != 1 || string(got[0]) != `{"id":"s1","v":2}` {
		t.Fatalf("got %q", got)
	}
}

func TestViewIsRememberedPerUserAndBoard(t *testing.T) {
	s := open(t)
	a := user(t, s, "a@example.com")
	b := user(t, s, "b@example.com")
	if _, err := s.CreateBoard("b1", a.ID, "Matma"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.View(a.ID, "b1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("nothing saved yet: got %v", err)
	}
	if err := s.SetView(a.ID, "b1", View{X: 10.5, Y: -20, Scale: 2}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetView(a.ID, "b1", View{X: 11, Y: -21, Scale: 1.5}); err != nil { // replaces
		t.Fatal(err)
	}
	got, err := s.View(a.ID, "b1")
	if err != nil || got != (View{X: 11, Y: -21, Scale: 1.5}) {
		t.Fatalf("got %+v %v", got, err)
	}
	if _, err := s.View(b.ID, "b1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another user has their own view: got %v", err)
	}
	if err := s.DeleteBoard("b1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.View(a.ID, "b1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a deleted board takes its views: got %v", err)
	}
}
