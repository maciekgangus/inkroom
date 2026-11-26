package store

import (
	"errors"
	"testing"
	"time"
)

func TestContactsAndSuggestions(t *testing.T) {
	s := openTestStore(t)
	now := time.Now().Truncate(time.Second)

	alice, _ := s.CreateAccount("alice@example.com", "alice", "h")
	bob, _ := s.CreateAccount("bob@example.com", "bob", "h")
	carol, _ := s.CreateAccount("carol@example.com", "carol", "h")
	dave, _ := s.CreateAccount("dave@example.com", "dave", "h")
	eve, _ := s.CreateAccount("eve@example.com", "eve", "h")
	stranger, _ := s.CreateAccount("stranger@example.com", "stranger", "h")
	_ = stranger // never interacted with alice -> must NEVER appear!

	// 1. Saved contact: bob
	if err := s.AddContact(alice.ID, alice.ID, now); !errors.Is(err, ErrSelfContact) {
		t.Fatalf("expected ErrSelfContact, got %v", err)
	}
	if err := s.AddContact(alice.ID, bob.ID, now); err != nil {
		t.Fatalf("add bob contact: %v", err)
	}
	if err := s.AddContact(alice.ID, bob.ID, now); !errors.Is(err, ErrAlreadyContact) {
		t.Fatalf("expected ErrAlreadyContact on duplicate, got %v", err)
	}

	// 2. Co-owner on alice's board: carol
	b1, _ := s.CreateBoard("b1", alice.ID, "Algebra")
	if err := s.AddBoardOwner(b1.ID, carol.ID, now.Add(time.Second)); err != nil {
		t.Fatalf("add carol co-owner: %v", err)
	}

	// 3. Visitor to alice's board: dave
	if err := s.RecordVisit(dave.ID, b1.ID, now.Add(2*time.Second)); err != nil {
		t.Fatalf("dave visit: %v", err)
	}

	// 4. Owner of a board alice visited: eve
	bEve, _ := s.CreateBoard("b-eve", eve.ID, "Fizyka")
	if err := s.RecordVisit(alice.ID, bEve.ID, now.Add(3*time.Second)); err != nil {
		t.Fatalf("alice visit eve board: %v", err)
	}

	// Suggestions for alice include bob (contact), carol (coowner), dave (visitor), eve (shared),
	// and NEVER include alice herself or stranger!
	got, err := s.ListContactSuggestions(alice.ID)
	if err != nil {
		t.Fatalf("list suggestions: %v", err)
	}
	byName := map[string]ContactSuggestion{}
	for _, c := range got {
		byName[c.Username] = c
	}
	if _, ok := byName["alice"]; ok {
		t.Fatalf("suggestions must not include self")
	}
	if _, ok := byName["stranger"]; ok {
		t.Fatalf("suggestions must not leak unrelated stranger account")
	}
	if len(got) != 4 {
		t.Fatalf("expected 4 suggestions, got %d: %+v", len(got), got)
	}
	if !byName["bob"].Saved || byName["bob"].Source != "contact" {
		t.Fatalf("expected bob saved contact, got %+v", byName["bob"])
	}
	if byName["carol"].Source != "coowner" {
		t.Fatalf("expected carol coowner, got %+v", byName["carol"])
	}
	if byName["dave"].Source != "visitor" {
		t.Fatalf("expected dave visitor, got %+v", byName["dave"])
	}
	if byName["eve"].Source != "shared" {
		t.Fatalf("expected eve shared, got %+v", byName["eve"])
	}

	// Removing bob from saved contacts removes him completely (no board interaction with alice).
	if err := s.RemoveContact(alice.ID, bob.ID); err != nil {
		t.Fatalf("remove bob contact: %v", err)
	}
	after, err := s.ListContactSuggestions(alice.ID)
	if err != nil {
		t.Fatalf("list after remove: %v", err)
	}
	for _, c := range after {
		if c.Username == "bob" {
			t.Fatalf("bob should be gone after removal, got %+v", after)
		}
	}

	// RememberContact is idempotent and silently saves a collaborator.
	if err := s.RememberContact(alice.ID, dave.ID, now.Add(5*time.Second)); err != nil {
		t.Fatalf("remember dave: %v", err)
	}
	if err := s.RememberContact(alice.ID, dave.ID, now.Add(6*time.Second)); err != nil {
		t.Fatalf("remember dave second time: %v", err)
	}
	after2, _ := s.ListContactSuggestions(alice.ID)
	foundDave := false
	for _, c := range after2 {
		if c.Username == "dave" && c.Saved && c.Relation == "visitor" {
			foundDave = true
		}
	}
	if !foundDave {
		t.Fatalf("expected dave saved with preserved relation=visitor after RememberContact, got %+v", after2)
	}
}
