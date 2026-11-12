package store

import (
	"errors"
	"testing"
	"time"
)

func TestReservedNames(t *testing.T) {
	for _, n := range []string{"Administrator", "administrator", "  ADMINISTRATOR ", "Admin.istrator", "administrator_", "a-d-m-i-n-i-s-t-r-a-t-o-r", "Administrator!"} {
		if !IsReservedName(n) {
			t.Errorf("%q is not reserved", n)
		}
	}
	for _, n := range []string{"admin", "administrators", "Administratorka", "Ola", "", "adm"} {
		if IsReservedName(n) {
			t.Errorf("%q is reserved", n)
		}
	}
}

func TestNobodyCanTakeTheReservedName(t *testing.T) {
	s := open(t)
	if _, err := s.CreateAccount("a@example.com", "Administrator", "h"); !errors.Is(err, ErrUsernameReserved) {
		t.Fatalf("CreateAccount = %v, want ErrUsernameReserved", err)
	}
	// a name made from an e-mail never lands on it either
	u, err := s.CreateUser("administrator@example.com", "h")
	if err != nil {
		t.Fatal(err)
	}
	if IsReservedName(u.Username) {
		t.Fatalf("made the name %q", u.Username)
	}
}

func seedAdmin(t *testing.T, s *Store) (ann, bob User) {
	t.Helper()
	ann = user(t, s, "ann@example.com")
	bob = user(t, s, "bob@example.com")
	if _, err := s.CreateBoard("b1", ann.ID, "Matma"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateBoard("b2", ann.ID, "Fizyka"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateBoard("b3", bob.ID, "Chemia"); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := s.Apply("b1", []Op{{Add: true, ID: "s1", Data: []byte(`{"id":"s1"}`)}, {Add: true, ID: "s2", Data: []byte(`{"id":"s2"}`)}}, now); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveImage("i1", "b1", "image/png", []byte("12345678")); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordVisit(bob.ID, "b1", now); err != nil {
		t.Fatal(err)
	}
	return ann, bob
}

func TestAdminUsers(t *testing.T) {
	s := open(t)
	ann, bob := seedAdmin(t, s)
	users, err := s.AdminUsers()
	if err != nil || len(users) != 2 {
		t.Fatalf("AdminUsers = %v, %v", users, err)
	}
	by := map[int64]AdminUser{}
	for _, u := range users {
		by[u.ID] = u
	}
	a, b := by[ann.ID], by[bob.ID]
	if a.Email != "ann@example.com" || a.Username != ann.Username || a.CreatedAt.IsZero() {
		t.Fatalf("ann: %+v", a)
	}
	if a.Owned != 2 || a.Visited != 0 || b.Owned != 1 || b.Visited != 1 {
		t.Fatalf("counts: ann %+v, bob %+v", a, b)
	}
	if a.Bytes < int64(8+len(`{"id":"s1"}`)*2) || b.Bytes != 0 {
		t.Fatalf("bytes: ann %d, bob %d", a.Bytes, b.Bytes)
	}
	if a.LastActive.IsZero() || b.LastActive.IsZero() {
		t.Fatalf("last active: %v, %v", a.LastActive, b.LastActive)
	}
}

func TestAdminBoards(t *testing.T) {
	s := open(t)
	ann, _ := seedAdmin(t, s)
	boards, err := s.AdminBoards()
	if err != nil || len(boards) != 3 {
		t.Fatalf("AdminBoards = %v, %v", boards, err)
	}
	var b1 AdminBoard
	for _, b := range boards {
		if b.ID == "b1" {
			b1 = b
		}
	}
	if b1.Name != "Matma" || b1.OwnerID != ann.ID || b1.Owner != ann.Username || b1.CreatedAt.IsZero() || b1.UpdatedAt.IsZero() {
		t.Fatalf("b1: %+v", b1)
	}
	if b1.Strokes != 2 || b1.Images != 1 || b1.Visitors != 1 || b1.Bytes < 8 {
		t.Fatalf("b1 counts: %+v", b1)
	}
}

func TestRenameUser(t *testing.T) {
	s := open(t)
	ann, bob := seedAdmin(t, s)
	if err := s.RenameUser(ann.ID, "Ania.K"); err != nil {
		t.Fatal(err)
	}
	if u, err := s.UserByLogin("ania.k"); err != nil || u.ID != ann.ID || u.Username != "Ania.K" {
		t.Fatalf("after rename: %+v, %v", u, err)
	}
	if _, err := s.UserByLogin(ann.Username); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the old name still logs in: %v", err)
	}
	if err := s.RenameUser(ann.ID, "ANIA.k"); err != nil {
		t.Fatalf("changing only the letter case of one's own name: %v", err)
	}
	if err := s.RenameUser(bob.ID, "ania.K"); !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("a taken name = %v", err)
	}
	if err := s.RenameUser(bob.ID, "Administrator"); !errors.Is(err, ErrUsernameReserved) {
		t.Fatalf("the reserved name = %v", err)
	}
	if err := s.RenameUser(9999, "nobody"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a missing user = %v", err)
	}
}

func TestDeleteUserTakesTheirBoardsAndSessions(t *testing.T) {
	s := open(t)
	ann, bob := seedAdmin(t, s)
	if err := s.CreateSession("tok", ann.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteUser(ann.ID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"b1", "b2"} {
		if _, err := s.Board(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("board %s still there: %v", id, err)
		}
	}
	if _, err := s.Board("b3"); err != nil {
		t.Errorf("bob's board is gone: %v", err)
	}
	if _, err := s.SessionUser("tok", time.Now()); err == nil {
		t.Error("the session survived")
	}
	if err := s.DeleteUser(ann.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleting twice = %v", err)
	}
	_ = bob
}

func TestDeleteUserSessions(t *testing.T) {
	s := open(t)
	ann, bob := seedAdmin(t, s)
	for _, tok := range []struct {
		t string
		u int64
	}{{"a1", ann.ID}, {"a2", ann.ID}, {"b1", bob.ID}} {
		if err := s.CreateSession(tok.t, tok.u, time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.DeleteUserSessions(ann.ID); err != nil {
		t.Fatal(err)
	}
	for _, tok := range []string{"a1", "a2"} {
		if _, err := s.SessionUser(tok, time.Now()); err == nil {
			t.Errorf("%s survived", tok)
		}
	}
	if _, err := s.SessionUser("b1", time.Now()); err != nil {
		t.Errorf("bob was logged out: %v", err)
	}
}

func TestSetBoardOwner(t *testing.T) {
	s := open(t)
	_, bob := seedAdmin(t, s)
	if err := s.SetBoardOwner("b1", bob.ID); err != nil {
		t.Fatal(err)
	}
	if b, _ := s.Board("b1"); b.OwnerID != bob.ID {
		t.Fatalf("owner %d", b.OwnerID)
	}
	if err := s.SetBoardOwner("nope", bob.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a missing board = %v", err)
	}
	if err := s.SetBoardOwner("b1", 9999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a missing user = %v", err)
	}
}
