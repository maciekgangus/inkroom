package room

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

type fakeStore struct {
	mu          sync.Mutex
	strokes     map[string][][]byte
	applied     map[string][]store.Op
	loads       map[string]int
	backgrounds map[string]string
	revoked     map[string]map[string]bool
}

func newFake() *fakeStore {
	return &fakeStore{strokes: map[string][][]byte{}, applied: map[string][]store.Op{}, loads: map[string]int{}, backgrounds: map[string]string{}, revoked: map[string]map[string]bool{}}
}

func (f *fakeStore) LoadStrokes(id string) ([][]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.loads[id]++
	return f.strokes[id], nil
}

func (f *fakeStore) LoadBackground(id string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if bg := f.backgrounds[id]; bg != "" {
		return bg, nil
	}
	return "plain", nil
}

func (f *fakeStore) Apply(id string, ops []store.Op, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.applied[id] = append(f.applied[id], ops...)
	return nil
}

func (f *fakeStore) ops(id string) []store.Op {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]store.Op(nil), f.applied[id]...)
}

func hubFor(t *testing.T, f *fakeStore) *Hub {
	t.Helper()
	h := NewHub(f, time.Hour) // flush only when asked
	t.Cleanup(h.Close)
	return h
}

func joinHub(t *testing.T, h *Hub, board string) (*Room, *Client) {
	t.Helper()
	c := NewClient(16)
	r, err := h.Join(board, c)
	if err != nil {
		t.Fatal(err)
	}
	return r, c
}

func TestJoinLoadsSavedStrokesIntoTheSnapshot(t *testing.T) {
	f := newFake()
	f.strokes["b1"] = [][]byte{[]byte(`{"id":"s1"}`), []byte(`{"id":"s2"}`)}
	h := hubFor(t, f)
	_, c := joinHub(t, h, "b1")
	if ids := strokeIDs(t, recv(t, c)); len(ids) != 2 || ids[0] != "s1" || ids[1] != "s2" {
		t.Fatalf("got %v", ids)
	}
}

func TestOperationsAreWrittenOnFlush(t *testing.T) {
	f := newFake()
	h := hubFor(t, f)
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	_ = r.Handle(c, []byte(add1))
	_ = r.Handle(c, []byte(add1)) // duplicate: written once
	_ = r.Handle(c, []byte(`{"t":"remove","id":"s1"}`))
	_ = r.Handle(c, []byte(`{"t":"remove","id":"s1"}`)) // already gone: not written
	_ = r.Handle(c, []byte(`{"t":"live","id":"s7","points":[]}`))
	if len(f.ops("b1")) != 0 {
		t.Fatal("nothing should be written before the flush")
	}
	h.Flush()
	ops := f.ops("b1")
	if len(ops) != 2 || !ops[0].Add || ops[0].ID != "s1" || ops[1].Add || ops[1].ID != "s1" {
		t.Fatalf("got %+v", ops)
	}
	h.Flush()
	if len(f.ops("b1")) != 2 {
		t.Fatal("a flush with nothing pending must not write again")
	}
}

func TestPeriodicFlush(t *testing.T) {
	f := newFake()
	h := NewHub(f, 10*time.Millisecond)
	defer h.Close()
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	_ = r.Handle(c, []byte(add1))
	deadline := time.Now().Add(2 * time.Second)
	for len(f.ops("b1")) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("periodic flush never happened")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestLastLeaverFlushesAndEvictsTheRoom(t *testing.T) {
	f := newFake()
	h := hubFor(t, f)
	r1, a := joinHub(t, h, "b1")
	_, b := joinHub(t, h, "b1")
	recv(t, a)
	recv(t, b)
	_ = r1.Handle(a, []byte(add1))

	h.Leave("b1", r1, a)
	if len(f.ops("b1")) != 0 {
		t.Fatal("room still has a client; no flush yet")
	}
	h.Leave("b1", r1, b)
	if len(f.ops("b1")) != 1 {
		t.Fatalf("leaving the last client should flush, got %+v", f.ops("b1"))
	}

	// The next visitor reloads from the store.
	f.strokes["b1"] = [][]byte{[]byte(`{"id":"s1"}`)}
	_, c := joinHub(t, h, "b1")
	if ids := strokeIDs(t, recv(t, c)); len(ids) != 1 {
		t.Fatalf("got %v", ids)
	}
	if f.loads["b1"] != 2 {
		t.Fatalf("loaded %d times, want 2", f.loads["b1"])
	}
}

func TestSecondJoinerSharesTheSameRoom(t *testing.T) {
	f := newFake()
	h := hubFor(t, f)
	r1, _ := joinHub(t, h, "b1")
	r2, _ := joinHub(t, h, "b1")
	if r1 != r2 || f.loads["b1"] != 1 {
		t.Fatalf("same=%v loads=%d", r1 == r2, f.loads["b1"])
	}
}

func TestDeleteKicksClientsAndDiscardsPendingWrites(t *testing.T) {
	f := newFake()
	h := hubFor(t, f)
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	_ = r.Handle(c, []byte(add1))
	recv(t, c)

	h.Delete("b1")
	if !c.Dropped() {
		t.Fatal("client should be dropped")
	}
	h.Flush()
	if len(f.ops("b1")) != 0 {
		t.Fatalf("pending writes of a deleted board must be discarded, got %+v", f.ops("b1"))
	}
}

func TestCloseFlushesEverything(t *testing.T) {
	f := newFake()
	h := NewHub(f, time.Hour)
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	_ = r.Handle(c, []byte(add1))
	h.Close()
	if len(f.ops("b1")) != 1 {
		t.Fatalf("got %+v", f.ops("b1"))
	}
}

type failingStore struct{ *fakeStore }

func (failingStore) LoadStrokes(string) ([][]byte, error) { return nil, errors.New("disk on fire") }

func TestJoinFailsWhenTheBoardCannotBeLoaded(t *testing.T) {
	h := NewHub(failingStore{newFake()}, time.Hour)
	defer h.Close()
	if _, err := h.Join("b1", NewClient(4)); err == nil {
		t.Fatal("expected an error")
	}
}

func TestJoinLoadsTheSavedBackground(t *testing.T) {
	f := newFake()
	f.backgrounds["b1"] = "lines"
	h := hubFor(t, f)
	_, c := joinHub(t, h, "b1")
	if m := recv(t, c); m["background"] != "lines" {
		t.Fatalf("got %v", m)
	}
}

func TestHubSetBackgroundReachesTheLoadedRoomOnly(t *testing.T) {
	h := hubFor(t, newFake())
	_, c := joinHub(t, h, "b1")
	recv(t, c)
	h.SetBackground("other", "grid") // not loaded: nothing happens
	none(t, c)
	h.SetBackground("b1", "grid")
	if m := recv(t, c); m["t"] != "background" || m["value"] != "grid" {
		t.Fatalf("got %v", m)
	}
}

func TestUpdatesAreWrittenAsReplaceOperations(t *testing.T) {
	f := newFake()
	h := hubFor(t, f)
	r, c := joinHub(t, h, "b1")
	recv(t, c)
	_ = r.Handle(c, []byte(add1))
	_ = r.Handle(c, []byte(add1v2))
	_ = r.Handle(c, []byte(`{"t":"update","stroke":{"id":"ghost","points":[]}}`)) // missing: not written
	h.Flush()
	ops := f.ops("b1")
	if len(ops) != 2 || !ops[0].Add || !ops[1].Replace || ops[1].ID != "s1" {
		t.Fatalf("got %+v", ops)
	}
}

func TestHubSetNameReachesTheClientsOfThatBoard(t *testing.T) {
	h := hubFor(t, newFake())
	_, c := joinHub(t, h, "b1")
	recv(t, c) // snapshot
	h.SetName("b1", "Nowa nazwa")
	if m := recv(t, c); m["t"] != "name" || m["value"] != "Nowa nazwa" {
		t.Fatalf("message = %v", m)
	}
	h.SetName("no-such-board", "x") // nobody there: nothing happens
}

func (f *fakeStore) LoadRevoked(id string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for p := range f.revoked[id] {
		out = append(out, p)
	}
	return out, nil
}

func (f *fakeStore) SetRevoked(id, person string, revoked bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.revoked[id] == nil {
		f.revoked[id] = map[string]bool{}
	}
	if revoked {
		f.revoked[id][person] = true
	} else {
		delete(f.revoked[id], person)
	}
	return nil
}

func TestHubSavesAndRestoresRevokedDrawing(t *testing.T) {
	f := newFake()
	h := hubFor(t, f)
	owner := NewClient(32)
	owner.Identify("own", "own")
	owner.SetPerson("u:1", true)
	r, err := h.Join("b1", owner)
	if err != nil {
		t.Fatal(err)
	}
	ann := NewClient(32)
	ann.Identify("ann", "ann")
	ann.SetPerson("g:ann", false)
	if _, err := h.Join("b1", ann); err != nil {
		t.Fatal(err)
	}
	_ = r.Handle(owner, []byte(`{"t":"perm","id":"ann","draw":false}`))
	if got, _ := f.LoadRevoked("b1"); len(got) != 1 || got[0] != "g:ann" {
		t.Fatalf("saved = %v", got)
	}
	// Everyone leaves; the room is dropped and loaded again with the saved rights.
	h.Leave("b1", r, owner)
	h.Leave("b1", r, ann)
	owner2, ann2 := NewClient(32), NewClient(32)
	owner2.SetPerson("u:1", true)
	ann2.Identify("ann", "ann")
	ann2.SetPerson("g:ann", false)
	r2, _ := h.Join("b1", owner2)
	_, _ = h.Join("b1", ann2)
	for len(owner2.Send) > 0 {
		<-owner2.Send
	}
	_ = r2.Handle(ann2, []byte(`{"t":"add","stroke":{"id":"s1","authorId":"x","color":"#111","size":4,"points":[[1,1,0.5]]}}`))
	if len(owner2.Send) != 0 {
		t.Fatal("the saved revocation was not applied after a reload")
	}
}
