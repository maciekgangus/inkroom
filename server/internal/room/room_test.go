package room

import (
	"encoding/json"
	"testing"
)

func recv(t *testing.T, c *Client) map[string]any {
	t.Helper()
	select {
	case b, ok := <-c.Send:
		if !ok {
			t.Fatal("client channel closed")
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatalf("bad json %q: %v", b, err)
		}
		return m
	default:
		t.Fatal("expected a message, got none")
		return nil
	}
}

func none(t *testing.T, c *Client) {
	t.Helper()
	select {
	case b := <-c.Send:
		t.Fatalf("unexpected message: %s", b)
	default:
	}
}

func join(r *Room) *Client {
	c := NewClient(16)
	r.Join(c)
	return c
}

func strokeIDs(t *testing.T, m map[string]any) []string {
	t.Helper()
	var ids []string
	for _, s := range m["strokes"].([]any) {
		ids = append(ids, s.(map[string]any)["id"].(string))
	}
	return ids
}

const add1 = `{"t":"add","stroke":{"id":"s1","authorId":"a","color":"#111","size":4,"z":1,"points":[[0,0,0.5]]}}`

func TestJoinSendsEmptySnapshot(t *testing.T) {
	r := New()
	c := join(r)
	m := recv(t, c)
	if m["t"] != "snapshot" || len(m["strokes"].([]any)) != 0 {
		t.Fatalf("got %v", m)
	}
}

func TestAddIsBroadcastToEveryoneIncludingSender(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	if err := r.Handle(a, []byte(add1)); err != nil {
		t.Fatal(err)
	}
	for _, c := range []*Client{a, b} {
		m := recv(t, c)
		if m["t"] != "add" || m["stroke"].(map[string]any)["id"] != "s1" {
			t.Fatalf("got %v", m)
		}
	}
}

func TestLateJoinerGetsStrokesInSnapshot(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	_ = r.Handle(a, []byte(add1))
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 1 || ids[0] != "s1" {
		t.Fatalf("got %v", ids)
	}
}

func TestAddIsIdempotent(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	_ = r.Handle(a, []byte(add1))
	_ = r.Handle(a, []byte(add1))
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 1 {
		t.Fatalf("got %v", ids)
	}
}

func TestRemoveDeletesAndIsBroadcast(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	_ = r.Handle(a, []byte(add1))
	recv(t, a)
	recv(t, b)
	if err := r.Handle(b, []byte(`{"t":"remove","id":"s1"}`)); err != nil {
		t.Fatal(err)
	}
	for _, c := range []*Client{a, b} {
		if m := recv(t, c); m["t"] != "remove" || m["id"] != "s1" {
			t.Fatalf("got %v", m)
		}
	}
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 0 {
		t.Fatalf("got %v", ids)
	}
}

func TestLiveGoesToOthersOnlyAndIsNotStored(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	live := `{"t":"live","id":"s2","authorId":"a","color":"#111","size":4,"points":[[1,1,0.5]]}`
	if err := r.Handle(a, []byte(live)); err != nil {
		t.Fatal(err)
	}
	none(t, a)
	if m := recv(t, b); m["t"] != "live" || m["id"] != "s2" {
		t.Fatalf("got %v", m)
	}
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 0 {
		t.Fatalf("live stroke was stored: %v", ids)
	}
}

func TestLeaveDropsUnfinishedLiveStrokes(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	_ = r.Handle(a, []byte(`{"t":"live","id":"s2","authorId":"a","color":"#111","size":4,"points":[[1,1,0.5]]}`))
	recv(t, b)
	r.Leave(a)
	m := recv(t, b)
	if m["t"] != "live_drop" || m["ids"].([]any)[0] != "s2" {
		t.Fatalf("got %v", m)
	}
}

func TestFinishedStrokeIsNoLongerLive(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	_ = r.Handle(a, []byte(`{"t":"live","id":"s1","authorId":"a","color":"#111","size":4,"points":[[1,1,0.5]]}`))
	_ = r.Handle(a, []byte(add1))
	recv(t, b)
	recv(t, b)
	recv(t, a)
	r.Leave(a)
	none(t, b)
}

func TestSlowClientIsDroppedWithoutBlockingOthers(t *testing.T) {
	r := New()
	fast := join(r)
	slow := NewClient(1)
	r.Join(slow) // the snapshot fills its buffer
	recv(t, fast)
	_ = r.Handle(fast, []byte(add1))
	if !slow.Dropped() {
		t.Fatal("slow client should be dropped")
	}
	if m := recv(t, fast); m["t"] != "add" {
		t.Fatalf("got %v", m)
	}
}

func TestInvalidMessagesAreRejected(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	for _, msg := range []string{
		`not json`,
		`{"t":"nope"}`,
		`{"t":"add","stroke":{"authorId":"a"}}`,
		`{"t":"add"}`,
		`{"t":"remove"}`,
		`{"t":"live"}`,
	} {
		if err := r.Handle(a, []byte(msg)); err == nil {
			t.Errorf("expected an error for %s", msg)
		}
	}
	none(t, a)
}

func TestHubCreatesUniqueHexIDsAndFindsRooms(t *testing.T) {
	h := NewHub()
	id1, id2 := h.Create(), h.Create()
	if id1 == id2 || len(id1) != 32 {
		t.Fatalf("bad ids %q %q", id1, id2)
	}
	if h.Get(id1) == nil {
		t.Fatal("room not found")
	}
	if h.Get("nope") != nil {
		t.Fatal("unknown id should give nil")
	}
}
