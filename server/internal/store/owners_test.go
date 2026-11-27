package store

import (
	"errors"
	"testing"
	"time"
)

func TestBoardOwnersCoOwnershipAndRemoval(t *testing.T) {
	s := openTestStore(t)
	now := time.Now().Truncate(time.Second)

	alice, err := s.CreateAccount("alice@example.com", "alice", "h")
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	bob, err := s.CreateAccount("bob@example.com", "bob", "h")
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	carol, err := s.CreateAccount("carol@example.com", "carol", "h")
	if err != nil {
		t.Fatalf("create carol: %v", err)
	}

	b, err := s.CreateBoard("board-1", alice.ID, "Algebra")
	if err != nil {
		t.Fatalf("create board: %v", err)
	}

	// Creator is automatically in board_owners.
	ok, err := s.IsBoardOwner(b.ID, alice.ID)
	if err != nil || !ok {
		t.Fatalf("expected alice to be owner, got ok=%v err=%v", ok, err)
	}
	ok, err = s.IsBoardOwner(b.ID, bob.ID)
	if err != nil || ok {
		t.Fatalf("expected bob not to be owner, got ok=%v err=%v", ok, err)
	}

	// Bob visits first, then is added as co-owner -> moves from visited to owned.
	if err := s.RecordVisit(bob.ID, b.ID, now); err != nil {
		t.Fatalf("record visit: %v", err)
	}
	if err := s.AddBoardOwner(b.ID, bob.ID, now.Add(time.Second)); err != nil {
		t.Fatalf("add co-owner: %v", err)
	}
	if err := s.AddBoardOwner(b.ID, bob.ID, now); !errors.Is(err, ErrAlreadyOwner) {
		t.Fatalf("expected ErrAlreadyOwner on duplicate, got %v", err)
	}
	if err := s.AddBoardOwner(b.ID, 99999, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for missing user, got %v", err)
	}

	bobOwned, err := s.BoardsOwnedBy(bob.ID)
	if err != nil || len(bobOwned) != 1 || bobOwned[0].ID != b.ID {
		t.Fatalf("expected bob to own board-1, got %+v err=%v", bobOwned, err)
	}
	bobVisited, err := s.BoardsVisitedBy(bob.ID)
	if err != nil || len(bobVisited) != 0 {
		t.Fatalf("expected bob to have 0 visited boards after becoming co-owner, got %+v err=%v", bobVisited, err)
	}

	// RecordVisit is a no-op for co-owners too.
	if err := s.RecordVisit(bob.ID, b.ID, now.Add(2*time.Second)); err != nil {
		t.Fatalf("record visit co-owner: %v", err)
	}
	bobVisited, _ = s.BoardsVisitedBy(bob.ID)
	if len(bobVisited) != 0 {
		t.Fatalf("co-owner visit should be ignored, got %+v", bobVisited)
	}

	// ListBoardOwners & BoardOwnersMap report both in order.
	owners, err := s.ListBoardOwners(b.ID)
	if err != nil || len(owners) != 2 || owners[0].Username != "alice" || owners[1].Username != "bob" {
		t.Fatalf("unexpected owners list: %+v err=%v", owners, err)
	}
	omap, err := s.BoardOwnersMap([]string{b.ID})
	if err != nil || len(omap[b.ID]) != 2 || omap[b.ID][0] != "alice" || omap[b.ID][1] != "bob" {
		t.Fatalf("unexpected owners map: %+v err=%v", omap, err)
	}

	// Removing original creator repoints boards.owner_id to bob and moves alice to visited.
	if err := s.RemoveBoardOwner(b.ID, alice.ID, now.Add(3*time.Second)); err != nil {
		t.Fatalf("remove original owner: %v", err)
	}
	updated, err := s.Board(b.ID)
	if err != nil || updated.OwnerID != bob.ID {
		t.Fatalf("expected boards.owner_id=%d, got %+v err=%v", bob.ID, updated, err)
	}
	aliceOwned, _ := s.BoardsOwnedBy(alice.ID)
	aliceVisited, _ := s.BoardsVisitedBy(alice.ID)
	if len(aliceOwned) != 0 || len(aliceVisited) != 1 || aliceVisited[0].OwnerName != "bob" {
		t.Fatalf("expected alice moved to visited with owner bob, owned=%+v visited=%+v", aliceOwned, aliceVisited)
	}

	// Cannot remove the last remaining owner.
	if err := s.RemoveBoardOwner(b.ID, bob.ID, now); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("expected ErrLastOwner, got %v", err)
	}

	// Adding carol then removing carol works cleanly.
	if err := s.AddBoardOwner(b.ID, carol.ID, now); err != nil {
		t.Fatalf("add carol: %v", err)
	}
	if err := s.RemoveBoardOwner(b.ID, carol.ID, now); err != nil {
		t.Fatalf("remove carol: %v", err)
	}
}

func TestBoardOwnershipTransferAndBulkTransfer(t *testing.T) {
	s := openTestStore(t)
	now := time.Now().Truncate(time.Second)

	alice, _ := s.CreateAccount("alice@example.com", "alice", "h")
	bob, _ := s.CreateAccount("bob@example.com", "bob", "h")
	carol, _ := s.CreateAccount("carol@example.com", "carol", "h")

	b1, _ := s.CreateBoard("b1", alice.ID, "Matma 1")
	b2, _ := s.CreateBoard("b2", alice.ID, "Matma 2")
	if err := s.AddBoardOwner(b1.ID, bob.ID, now); err != nil {
		t.Fatalf("add bob: %v", err)
	}

	// Transferring b1 (co-owned by alice & bob) to carol makes carol sole owner
	// and moves both alice and bob to visited.
	if err := s.TransferBoardOwnership(b1.ID, carol.ID, now); err != nil {
		t.Fatalf("transfer b1: %v", err)
	}
	owners, _ := s.ListBoardOwners(b1.ID)
	if len(owners) != 1 || owners[0].UserID != carol.ID {
		t.Fatalf("expected sole owner carol, got %+v", owners)
	}
	for _, uid := range []int64{alice.ID, bob.ID} {
		vis, _ := s.BoardsVisitedBy(uid)
		if len(vis) != 1 || vis[0].ID != b1.ID || vis[0].OwnerName != "carol" {
			t.Fatalf("expected user %d to see b1 in visited with owner carol, got %+v", uid, vis)
		}
	}

	// Transferring solely to the already-sole owner fails cleanly.
	if err := s.TransferBoardOwnership(b1.ID, carol.ID, now); !errors.Is(err, ErrAlreadyOwner) {
		t.Fatalf("expected ErrAlreadyOwner transferring to sole owner, got %v", err)
	}

	// Bulk transfer of [b2] by alice to bob succeeds; including unowned b1 fails atomically.
	if err := s.TransferBoardsOwnership([]string{b1.ID, b2.ID}, alice.ID, bob.ID, now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden when bulk transferring unowned board, got %v", err)
	}
	// b2 should still belong to alice.
	ok, _ := s.IsBoardOwner(b2.ID, alice.ID)
	if !ok {
		t.Fatalf("failed bulk transfer should not mutate b2")
	}
	if err := s.TransferBoardsOwnership([]string{b2.ID}, alice.ID, bob.ID, now); err != nil {
		t.Fatalf("bulk transfer b2: %v", err)
	}
	ok, _ = s.IsBoardOwner(b2.ID, bob.ID)
	if !ok {
		t.Fatalf("expected bob to own b2 after bulk transfer")
	}
	aliceVis, _ := s.BoardsVisitedBy(alice.ID)
	if len(aliceVis) != 2 {
		t.Fatalf("expected alice to have both b1 and b2 in visited, got %+v", aliceVis)
	}
}

func TestDeleteUserPreservesCoOwnedBoards(t *testing.T) {
	s := openTestStore(t)
	now := time.Now().Truncate(time.Second)

	alice, _ := s.CreateAccount("alice@example.com", "alice", "h")
	bob, _ := s.CreateAccount("bob@example.com", "bob", "h")

	solo, _ := s.CreateBoard("solo", alice.ID, "Tylko moja")
	shared, _ := s.CreateBoard("shared", alice.ID, "Wspólna")
	if err := s.AddBoardOwner(shared.ID, bob.ID, now); err != nil {
		t.Fatalf("add bob: %v", err)
	}

	// Only solo should appear in BoardsSolelyOwnedBy(alice).
	sole, err := s.BoardsSolelyOwnedBy(alice.ID)
	if err != nil || len(sole) != 1 || sole[0].ID != solo.ID {
		t.Fatalf("expected only solo board, got %+v err=%v", sole, err)
	}

	// Deleting alice deletes solo, but shared survives under bob!
	if err := s.DeleteUser(alice.ID); err != nil {
		t.Fatalf("delete alice: %v", err)
	}
	if _, err := s.Board(solo.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected solo board deleted, got %v", err)
	}
	kept, err := s.Board(shared.ID)
	if err != nil || kept.OwnerID != bob.ID {
		t.Fatalf("expected shared board preserved with bob as owner, got %+v err=%v", kept, err)
	}
	owners, _ := s.ListBoardOwners(shared.ID)
	if len(owners) != 1 || owners[0].UserID != bob.ID {
		t.Fatalf("expected bob as sole remaining owner, got %+v", owners)
	}
}
