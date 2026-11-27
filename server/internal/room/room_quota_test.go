package room

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

func withQuota(t *testing.T, n int64) {
	t.Helper()
	old := store.MaxBoardBytes
	store.MaxBoardBytes = n
	t.Cleanup(func() { store.MaxBoardBytes = old })
}

func strokeMsg(t, id string, points int) []byte {
	return []byte(`{"t":"` + t + `","stroke":{"id":"` + id + `","points":[` + strings.Repeat("[1,1,0.5],", points) + `[1,1,0.5]]}}`)
}

func TestAFullBoardRefusesTheStrokeAndTellsItsAuthorWithoutClosing(t *testing.T) {
	withQuota(t, 150) // a 5-point stroke is 86 bytes

	r := New()
	c := join(r)
	other := join(r)
	recv(t, c)
	recv(t, other)
	if err := r.Handle(c, strokeMsg("add", "s1", 5)); err != nil {
		t.Fatal(err)
	}
	recv(t, c)
	recv(t, other)
	// The author was showing it as a live stroke; the others must drop it.
	if err := r.Handle(c, []byte(`{"t":"live","id":"s2","points":[[1,1,0.5]]}`)); err != nil {
		t.Fatal(err)
	}
	recv(t, other)
	// 86 + 86 > 150: refused, but the connection stays (no error) and only the author is told.
	if err := r.Handle(c, strokeMsg("add", "s2", 5)); err != nil {
		t.Fatalf("a full board is not misbehaviour: %v", err)
	}
	if m := recv(t, c); m["t"] != "full" || m["id"] != "s2" || m["stroke"] != nil {
		t.Fatalf("author got %v, want full for s2", m)
	}
	if m := recv(t, other); m["t"] != "live_drop" {
		t.Fatalf("other got %v, want live_drop", m)
	}
	none(t, other)
	// An update that grows past the quota is refused too, and the author gets the element back.
	if err := r.Handle(c, strokeMsg("update", "s1", 15)); err != nil {
		t.Fatal(err)
	}
	m := recv(t, c)
	if st, _ := m["stroke"].(map[string]any); m["t"] != "full" || st == nil || len(st["points"].([]any)) != 6 {
		t.Fatalf("author got %v, want full with the old s1", m)
	}
	none(t, other)
	// Removing frees room again.
	if err := r.Handle(c, []byte(`{"t":"remove","id":"s1"}`)); err != nil {
		t.Fatal(err)
	}
	recv(t, c)
	if err := r.Handle(c, strokeMsg("add", "s2", 5)); err != nil {
		t.Fatalf("add after remove: %v", err)
	}
	if m := recv(t, c); m["t"] != "add" {
		t.Fatalf("got %v, want the add echoed", m)
	}
}

func TestTheRoomCountsTheBoardsImagesAsTheStoreDoes(t *testing.T) {
	withQuota(t, 200)
	f := newFake()
	f.images["b1"] = 100 // 100 + 86 fits, 100 + 86 + 86 does not
	h := hubFor(t, f)
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	if err := r.Handle(c, strokeMsg("add", "s1", 5)); err != nil {
		t.Fatal(err)
	}
	if m := recv(t, c); m["t"] != "add" {
		t.Fatalf("got %v, want add", m)
	}
	if err := r.Handle(c, strokeMsg("add", "s2", 5)); err != nil {
		t.Fatal(err)
	}
	if m := recv(t, c); m["t"] != "full" {
		t.Fatalf("got %v, want full", m)
	}
	// An image uploaded while people draw takes room as well.
	if err := r.Handle(c, []byte(`{"t":"remove","id":"s1"}`)); err != nil {
		t.Fatal(err)
	}
	recv(t, c)
	h.AddImageBytes("b1", 50)
	if err := r.Handle(c, strokeMsg("add", "s3", 5)); err != nil {
		t.Fatal(err)
	}
	if m := recv(t, c); m["t"] != "full" {
		t.Fatalf("after an upload got %v, want full", m)
	}
}

// quotaStore refuses, as the real store over its quota does, every batch that adds "big".
type quotaStore struct {
	*fakeStore
	refused int
}

func (q *quotaStore) Apply(id string, ops []store.Op, at time.Time) error {
	for _, op := range ops {
		if op.Add && op.ID == "big" {
			q.mu.Lock()
			q.refused++
			q.mu.Unlock()
			return store.ErrQuota
		}
	}
	return q.fakeStore.Apply(id, ops, at)
}

func TestABatchOverTheQuotaIsSavedWithoutTheOpThatDoesNotFit(t *testing.T) {
	f := newFake()
	f.strokes["b1"] = [][]byte{[]byte(`{"id":"old"}`)}
	q := &quotaStore{fakeStore: f}
	h := NewHub(q, time.Hour)
	t.Cleanup(h.Close)
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	for _, msg := range []string{
		`{"t":"add","stroke":{"id":"s1"}}`,
		`{"t":"add","stroke":{"id":"big"}}`,
		`{"t":"remove","id":"old"}`,
	} {
		if err := r.Handle(c, []byte(msg)); err != nil {
			t.Fatal(err)
		}
	}
	h.Flush()
	got := f.ops("b1")
	if len(got) != 2 || got[0].ID != "s1" || got[1].ID != "old" || got[1].Add {
		t.Fatalf("saved %+v, want s1 added and old removed", got)
	}
	refused := q.refused
	// Nothing is left to retry: later flushes do not hit the quota again, and later changes are saved.
	if err := r.Handle(c, []byte(`{"t":"remove","id":"s1"}`)); err != nil {
		t.Fatal(err)
	}
	h.Flush()
	h.Flush()
	if q.refused != refused {
		t.Fatalf("the refused op was retried: %d refusals, want %d", q.refused, refused)
	}
	if got := f.ops("b1"); len(got) != 3 || got[2].ID != "s1" || got[2].Add {
		t.Fatalf("saved %+v, want the later remove too", got)
	}
}

func TestOtherSaveErrorsStillKeepTheBatchForARetry(t *testing.T) {
	f := newFake()
	h := NewHub(diskFullStore{f}, time.Hour)
	t.Cleanup(h.Close)
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	_ = r.Handle(c, []byte(add1))
	h.Flush()
	r.mu.Lock()
	n := len(r.pending)
	r.mu.Unlock()
	if n != 1 {
		t.Fatalf("pending = %d, want the batch kept", n)
	}
}

type diskFullStore struct{ *fakeStore }

func (diskFullStore) Apply(string, []store.Op, time.Time) error { return errors.New("disk full") }
