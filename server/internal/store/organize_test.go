package store

import (
	"errors"
	"path/filepath"
	"reflect"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func ptr[T any](v T) *T { return &v }

func TestFoldersCRUDAndIsolation(t *testing.T) {
	st := openTestStore(t)
	u1, err := st.CreateUser("a@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	u2, err := st.CreateUser("b@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}

	f1, err := st.CreateFolder("f1", u1.ID, "Matematyka", "indigo")
	if err != nil {
		t.Fatal(err)
	}
	f2, err := st.CreateFolder("f2", u1.ID, "Fizyka", "emerald")
	if err != nil {
		t.Fatal(err)
	}
	if f1.Position != 0 || f2.Position != 1 {
		t.Fatalf("positions = %d, %d; want 0, 1", f1.Position, f2.Position)
	}

	// Duplicate name (case-insensitive) for the same user fails; another user may use it.
	if _, err := st.CreateFolder("f3", u1.ID, "matematyka", ""); !errors.Is(err, ErrDuplicateName) {
		t.Fatalf("duplicate folder = %v, want ErrDuplicateName", err)
	}
	if _, err := st.CreateFolder("f4", u2.ID, "Matematyka", "amber"); err != nil {
		t.Fatalf("other user same folder name: %v", err)
	}

	// Rename & recolor own folder; another user cannot edit or delete it.
	if _, err := st.UpdateFolder(u2.ID, "f1", ptr("Hack"), nil, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user update = %v, want ErrNotFound", err)
	}
	if err := st.DeleteFolder(u2.ID, "f1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other user delete = %v, want ErrNotFound", err)
	}
	upd, err := st.UpdateFolder(u1.ID, "f1", ptr("Algebra"), ptr("rose"), ptr(5))
	if err != nil {
		t.Fatal(err)
	}
	if upd.Name != "Algebra" || upd.Color != "rose" || upd.Position != 5 {
		t.Fatalf("updated = %+v", upd)
	}

	list, err := st.ListFolders(u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "f2" || list[1].ID != "f1" {
		t.Fatalf("ordered folders = %+v", list)
	}

	// Deleting a folder unfiles boards in it without deleting the boards.
	b, err := st.CreateBoard("b1", u1.ID, "Równania")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateBoardMeta(u1.ID, b.ID, BoardMetaPatch{FolderID: ptr("f2")}); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteFolder(u1.ID, "f2"); err != nil {
		t.Fatal(err)
	}
	meta, err := st.BoardMetaMap(u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if meta[b.ID].FolderID != "" {
		t.Fatalf("folder not cleared after delete: %+v", meta[b.ID])
	}
	if _, err := st.Board(b.ID); err != nil {
		t.Fatalf("board should still exist: %v", err)
	}
}

func TestMarkersAndBoardMetaAndBulk(t *testing.T) {
	st := openTestStore(t)
	u1, _ := st.CreateUser("a@example.com", "hash")
	u2, _ := st.CreateUser("b@example.com", "hash")
	b1, _ := st.CreateBoard("b1", u1.ID, "Matma")
	b2, _ := st.CreateBoard("b2", u2.ID, "Udostępniona")

	f1, _ := st.CreateFolder("f1", u1.ID, "Liceum", "sky")
	f2, _ := st.CreateFolder("f2", u2.ID, "Cudzy", "amber")
	m1, err := st.CreateMarker("m1", u1.ID, "Matura", "rose")
	if err != nil {
		t.Fatal(err)
	}
	m2, err := st.CreateMarker("m2", u1.ID, "Pilne", "amber")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateMarker("m3", u1.ID, "matura", "sky"); !errors.Is(err, ErrDuplicateName) {
		t.Fatalf("duplicate marker = %v", err)
	}

	// User 1 cannot assign user 2's folder.
	if err := st.UpdateBoardMeta(u1.ID, b1.ID, BoardMetaPatch{FolderID: ptr(f2.ID)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign folder = %v, want ErrNotFound", err)
	}

	// User 1 can organize both own board and another user's board (for their own panel).
	if err := st.UpdateBoardMeta(u1.ID, b2.ID, BoardMetaPatch{
		FolderID:  ptr(f1.ID),
		Pinned:    ptr(true),
		MarkerIDs: ptr([]string{m1.ID, m2.ID}),
	}); err != nil {
		t.Fatal(err)
	}
	meta, err := st.BoardMetaMap(u1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if meta[b2.ID].FolderID != f1.ID || !meta[b2.ID].Pinned || !reflect.DeepEqual(meta[b2.ID].MarkerIDs, []string{m1.ID, m2.ID}) {
		t.Fatalf("meta[b2] = %+v", meta[b2.ID])
	}
	// User 2 does not see user 1's organization.
	meta2, _ := st.BoardMetaMap(u2.ID)
	if len(meta2) != 0 {
		t.Fatalf("user 2 leaked meta: %+v", meta2)
	}

	// Bulk organize moves both boards and updates markers.
	if err := st.BulkOrganize(u1.ID, BulkOrganizePatch{
		BoardIDs:        []string{b1.ID, b2.ID},
		FolderID:        ptr(f1.ID),
		AddMarkerIDs:    []string{m1.ID},
		RemoveMarkerIDs: []string{m2.ID},
		Pinned:          ptr(true),
	}); err != nil {
		t.Fatal(err)
	}
	meta, _ = st.BoardMetaMap(u1.ID)
	if !reflect.DeepEqual(meta[b1.ID].MarkerIDs, []string{m1.ID}) || !reflect.DeepEqual(meta[b2.ID].MarkerIDs, []string{m1.ID}) {
		t.Fatalf("after bulk: b1=%+v b2=%+v", meta[b1.ID], meta[b2.ID])
	}

	// Custom order persists.
	if err := st.SetBoardOrder(u1.ID, []string{b2.ID, b1.ID}); err != nil {
		t.Fatal(err)
	}
	meta, _ = st.BoardMetaMap(u1.ID)
	if meta[b2.ID].Position != 1 || meta[b1.ID].Position != 2 {
		t.Fatalf("positions after reorder: b2=%d b1=%d", meta[b2.ID].Position, meta[b1.ID].Position)
	}

	// Deleting a marker removes it from boards.
	if err := st.DeleteMarker(u1.ID, m1.ID); err != nil {
		t.Fatal(err)
	}
	meta, _ = st.BoardMetaMap(u1.ID)
	if len(meta[b1.ID].MarkerIDs) != 0 {
		t.Fatalf("marker link lingered: %+v", meta[b1.ID])
	}
}
