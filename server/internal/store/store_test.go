package store

import (
	"errors"
	"path/filepath"
	"strings"
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

func TestRevokedDrawingIsSavedPerBoardAndGoneWithIt(t *testing.T) {
	s := open(t)
	a := user(t, s, "a@example.com")
	for _, id := range []string{"b1", "b2"} {
		if _, err := s.CreateBoard(id, a.ID, "Matma"); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := s.LoadRevoked("b1"); err != nil || len(got) != 0 {
		t.Fatalf("nothing revoked yet: %v %v", got, err)
	}
	for _, p := range []string{"g:ann", "g:bob"} {
		if err := s.SetRevoked("b1", p, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.SetRevoked("b1", "g:ann", true); err != nil { // twice is fine
		t.Fatal(err)
	}
	if err := s.SetRevoked("b1", "g:bob", false); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadRevoked("b1")
	if err != nil || len(got) != 1 || got[0] != "g:ann" {
		t.Fatalf("b1 revoked = %v %v", got, err)
	}
	if got, _ := s.LoadRevoked("b2"); len(got) != 0 {
		t.Fatalf("another board is not affected: %v", got)
	}
	if err := s.DeleteBoard("b1"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.LoadRevoked("b1"); len(got) != 0 {
		t.Fatalf("a deleted board takes its list: %v", got)
	}
}

func TestCopyBoardCopiesStrokesImagesAndBackground(t *testing.T) {
	s := open(t)
	a := user(t, s, "a@example.com")
	b := user(t, s, "b@example.com")
	if _, err := s.CreateBoard("src", a.ID, "Matma"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBoardBackground("src", "grid"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveImage("img1", "src", "image/png", []byte("PNGDATA")); err != nil {
		t.Fatal(err)
	}
	ops := []Op{
		{Add: true, ID: "s1", Data: []byte(`{"id":"s1","points":[[1,2,0.5]]}`)},
		{Add: true, ID: "s2", Data: []byte(`{"id":"s2","kind":"image","src":"img1","points":[[0,0,0.5],[9,9,0.5]]}`)},
	}
	if err := s.Apply("src", ops, time.Now()); err != nil {
		t.Fatal(err)
	}
	n := 0
	cp, err := s.CopyBoard("src", "dst", b.ID, "Matma (kopia)", func() string { n++; return "newimg" })
	if err != nil {
		t.Fatal(err)
	}
	if cp.ID != "dst" || cp.OwnerID != b.ID || cp.Name != "Matma (kopia)" || cp.Background != "grid" {
		t.Fatalf("copy = %+v", cp)
	}
	strokes, err := s.LoadStrokes("dst")
	if err != nil || len(strokes) != 2 {
		t.Fatalf("strokes = %q %v", strokes, err)
	}
	if string(strokes[0]) != `{"id":"s1","points":[[1,2,0.5]]}` {
		t.Fatalf("a plain stroke is copied as it is: %s", strokes[0])
	}
	if !strings.Contains(string(strokes[1]), `"src":"newimg"`) || strings.Contains(string(strokes[1]), "img1") {
		t.Fatalf("the copied picture must point at the copied image: %s", strokes[1])
	}
	mime, data, err := s.Image("dst", "newimg")
	if err != nil || mime != "image/png" || string(data) != "PNGDATA" {
		t.Fatalf("copied image = %q %q %v", mime, data, err)
	}
	// The original is untouched and the copy lives on its own.
	if orig, _ := s.LoadStrokes("src"); len(orig) != 2 || !strings.Contains(string(orig[1]), "img1") {
		t.Fatalf("original changed: %q", orig)
	}
	if err := s.DeleteBoard("src"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.LoadStrokes("dst"); len(got) != 2 {
		t.Fatal("deleting the original took the copy's strokes")
	}
	if _, _, err := s.Image("dst", "newimg"); err != nil {
		t.Fatal("deleting the original took the copy's image")
	}
}

func TestCopyBoardOfAMissingBoardFails(t *testing.T) {
	s := open(t)
	a := user(t, s, "a@example.com")
	if _, err := s.CopyBoard("nope", "dst", a.ID, "x", func() string { return "i" }); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
	if _, err := s.Board("dst"); !errors.Is(err, ErrNotFound) {
		t.Fatal("a failed copy left a board behind")
	}
}

func TestUsernamesAreUniqueIgnoringCaseAndFindableByLogin(t *testing.T) {
	s := open(t)
	u, err := s.CreateAccount("ola@example.com", "Ola.K", "hash")
	if err != nil || u.Username != "Ola.K" {
		t.Fatalf("created %+v %v", u, err)
	}
	if _, err := s.CreateAccount("inna@example.com", "ola.k", "hash"); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("a name differing in case must be taken: %v", err)
	}
	if _, err := s.CreateAccount("ola@example.com", "ktos", "hash"); !errors.Is(err, ErrEmailTaken) {
		t.Fatalf("e-mail taken: %v", err)
	}
	for _, login := range []string{"ola@example.com", "OLA.K", "Ola.K"} {
		got, err := s.UserByLogin(login)
		if err != nil || got.ID != u.ID || got.Username != "Ola.K" {
			t.Fatalf("login %q: %+v %v", login, got, err)
		}
	}
	if _, err := s.UserByLogin("nikt"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown: %v", err)
	}
}

func TestCreateUserWithoutANameDerivesOneFromTheEmail(t *testing.T) {
	s := open(t)
	got := []string{}
	for _, c := range []string{"jan.kowalski@example.com", "jan.kowalski@other.org", "a@example.com", "ab+cd@example.com"} {
		u, err := s.CreateUser(c, "hash")
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, u.Username)
	}
	want := []string{"jan.kowalski", "jan.kowalski2", "a00", "abcd"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("names = %v, want %v", got, want)
		}
	}
}

func TestMigrationGivesExistingAccountsANameFromTheirEmail(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	// A database as it was before usernames: the first five migrations only.
	old, err := openMigrated(path, 5)
	if err != nil {
		t.Fatal(err)
	}
	for i, e := range []string{"jan@example.com", "jan@other.org", "zo.sia+x@example.com"} {
		if _, err := old.db.Exec("INSERT INTO users (email, hash, created_at) VALUES (?, 'h', ?)", e, i); err != nil {
			t.Fatal(err)
		}
	}
	old.Close()
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for email, want := range map[string]string{"jan@example.com": "jan", "jan@other.org": "jan2", "zo.sia+x@example.com": "zo.siax"} {
		u, err := s.UserByLogin(email)
		if err != nil || u.Username != want {
			t.Fatalf("%s: %+v %v, want %s", email, u, err, want)
		}
	}
}
