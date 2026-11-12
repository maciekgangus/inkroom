package room

import (
	"encoding/json"
	"strings"
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

const cursorMsg = `{"t":"cursor","id":"a","name":"Ola","x":10.5,"y":20}`

func TestCursorGoesToOthersOnlyAndIsNotStored(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	if err := r.Handle(a, []byte(cursorMsg)); err != nil {
		t.Fatal(err)
	}
	none(t, a)
	if m := recv(t, b); m["t"] != "cursor" || m["id"] != "a" || m["name"] != "Ola" {
		t.Fatalf("got %v", m)
	}
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 0 {
		t.Fatalf("cursor was stored: %v", ids)
	}
}

func TestHiddenCursorIsRelayed(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	if err := r.Handle(a, []byte(`{"t":"cursor","id":"a","hidden":true}`)); err != nil {
		t.Fatal(err)
	}
	if m := recv(t, b); m["hidden"] != true {
		t.Fatalf("got %v", m)
	}
}

func TestLeaveDropsTheCursor(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	_ = r.Handle(a, []byte(cursorMsg))
	recv(t, b)
	r.Leave(a)
	m := recv(t, b)
	if m["t"] != "cursor_drop" || m["ids"].([]any)[0] != "a" {
		t.Fatalf("got %v", m)
	}
}

func TestLeavingWithoutACursorSendsNothing(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	r.Leave(a)
	none(t, b)
}

func TestHiddenCursorIsNotDroppedAgainOnLeave(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	_ = r.Handle(a, []byte(cursorMsg))
	_ = r.Handle(a, []byte(`{"t":"cursor","id":"a","hidden":true}`))
	recv(t, b)
	recv(t, b)
	r.Leave(a)
	none(t, b)
}

func TestInvalidCursorsAreRejected(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	long := strings.Repeat("x", 65)
	for _, msg := range []string{
		`{"t":"cursor"}`,
		`{"t":"cursor","id":"","x":1,"y":1}`,
		`{"t":"cursor","id":"` + long + `","x":1,"y":1}`,
		`{"t":"cursor","id":"a","name":"` + long + `","x":1,"y":1}`,
	} {
		if err := r.Handle(a, []byte(msg)); err == nil {
			t.Errorf("expected an error for %.60s", msg)
		}
	}
}

func TestSnapshotCarriesTheBackground(t *testing.T) {
	r := New()
	if m := recv(t, join(r)); m["background"] != "plain" {
		t.Fatalf("default: got %v", m)
	}
	r.SetBackground("grid")
	if m := recv(t, join(r)); m["background"] != "grid" {
		t.Fatalf("after change: got %v", m)
	}
}

func TestSetBackgroundIsBroadcastToEveryone(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	r.SetBackground("dots")
	for _, c := range []*Client{a, b} {
		if m := recv(t, c); m["t"] != "background" || m["value"] != "dots" {
			t.Fatalf("got %v", m)
		}
	}
}

func TestClientsCannotChangeTheBackground(t *testing.T) {
	r := New()
	c := join(r)
	if err := r.Handle(c, []byte(`{"t":"background","value":"grid"}`)); err == nil {
		t.Fatal("a background message from a client must be rejected")
	}
}

const add1v2 = `{"t":"update","stroke":{"id":"s1","authorId":"a","color":"#111","size":4,"z":1,"points":[[5,5,0.5]]}}`

func TestUpdateReplacesAnElementAndIsBroadcastToEveryone(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	_ = r.Handle(a, []byte(add1))
	recv(t, a)
	recv(t, b)
	if err := r.Handle(b, []byte(add1v2)); err != nil {
		t.Fatal(err)
	}
	for _, c := range []*Client{a, b} {
		if m := recv(t, c); m["t"] != "update" || m["stroke"].(map[string]any)["id"] != "s1" {
			t.Fatalf("got %v", m)
		}
	}
	late := join(r)
	snap := recv(t, late)
	pts := snap["strokes"].([]any)[0].(map[string]any)["points"].([]any)[0].([]any)
	if pts[0].(float64) != 5 {
		t.Fatalf("snapshot still has the old version: %v", snap)
	}
}

func TestUpdateKeepsTheElementsPlaceInTheSnapshot(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	_ = r.Handle(a, []byte(add1))
	_ = r.Handle(a, []byte(`{"t":"add","stroke":{"id":"s2","z":2,"points":[]}}`))
	_ = r.Handle(a, []byte(add1v2))
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 2 || ids[0] != "s1" || ids[1] != "s2" {
		t.Fatalf("got %v", ids)
	}
}

func TestUpdateOfAMissingElementIsIgnored(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	if err := r.Handle(a, []byte(add1v2)); err != nil {
		t.Fatal(err)
	}
	none(t, a)
	none(t, b)
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 0 {
		t.Fatalf("an update must not create an element: %v", ids)
	}
}

func TestUpdateAfterRemoveDoesNotBringItBack(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	_ = r.Handle(a, []byte(add1))
	_ = r.Handle(a, []byte(`{"t":"remove","id":"s1"}`))
	_ = r.Handle(a, []byte(add1v2))
	late := join(r)
	if ids := strokeIDs(t, recv(t, late)); len(ids) != 0 {
		t.Fatalf("got %v", ids)
	}
}

func TestAddDoesNotOverwriteAnUpdatedElement(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	_ = r.Handle(a, []byte(add1))
	_ = r.Handle(a, []byte(add1v2))
	_ = r.Handle(a, []byte(add1)) // a stale resend after a reconnect
	late := join(r)
	snap := recv(t, late)
	pts := snap["strokes"].([]any)[0].(map[string]any)["points"].([]any)[0].([]any)
	if pts[0].(float64) != 5 {
		t.Fatalf("the stale add overwrote the update: %v", snap)
	}
}

func TestInvalidUpdatesAreRejected(t *testing.T) {
	r := New()
	a := join(r)
	recv(t, a)
	for _, msg := range []string{`{"t":"update"}`, `{"t":"update","stroke":{"authorId":"a"}}`} {
		if err := r.Handle(a, []byte(msg)); err == nil {
			t.Errorf("expected an error for %s", msg)
		}
	}
}

func joinAs(r *Room, id, name string) *Client {
	c := NewClient(16)
	c.Identify(id, name)
	r.Join(c)
	return c
}

func peerNames(m map[string]any) []string {
	var names []string
	for _, p := range m["peers"].([]any) {
		names = append(names, p.(map[string]any)["name"].(string))
	}
	return names
}

func TestIdentifiedJoinTellsEveryoneWhoIsHere(t *testing.T) {
	r := New()
	ann := joinAs(r, "a1", "Ann")
	if m := recv(t, ann); m["t"] != "snapshot" {
		t.Fatalf("first message = %v, want the snapshot", m["t"])
	}
	if m := recv(t, ann); m["t"] != "peers" || len(peerNames(m)) != 1 {
		t.Fatalf("joiner's peers = %v", m)
	}
	bob := joinAs(r, "b1", "Bob")
	recv(t, bob) // snapshot
	for _, c := range []*Client{ann, bob} {
		m := recv(t, c)
		if m["t"] != "peers" {
			t.Fatalf("message = %v, want peers", m)
		}
		if names := peerNames(m); len(names) != 2 || names[0] != "Ann" || names[1] != "Bob" {
			t.Fatalf("peers = %v, want [Ann Bob]", names)
		}
	}
}

func TestPeersCarryTheirIDs(t *testing.T) {
	r := New()
	c := joinAs(r, "a1", "Ann")
	recv(t, c)
	m := recv(t, c)
	p := m["peers"].([]any)[0].(map[string]any)
	if p["id"] != "a1" || p["name"] != "Ann" {
		t.Fatalf("peer = %v", p)
	}
}

func TestAnonymousClientsAreNotListedAndSendNothing(t *testing.T) {
	r := New()
	ann := joinAs(r, "a1", "Ann")
	recv(t, ann)
	recv(t, ann)
	anon := join(r)
	recv(t, anon) // its snapshot, and nothing more
	none(t, anon)
	none(t, ann)
	r.Leave(anon)
	none(t, ann)
}

func TestLeavingTellsTheOthers(t *testing.T) {
	r := New()
	ann := joinAs(r, "a1", "Ann")
	bob := joinAs(r, "b1", "Bob")
	for _, c := range []*Client{ann, ann, ann, bob, bob} {
		recv(t, c)
	}
	r.Leave(bob)
	m := recv(t, ann)
	if m["t"] != "peers" {
		t.Fatalf("message = %v, want peers", m)
	}
	if names := peerNames(m); len(names) != 1 || names[0] != "Ann" {
		t.Fatalf("peers = %v, want [Ann]", names)
	}
}

func TestTheSameIDIsListedOnce(t *testing.T) {
	r := New()
	first := joinAs(r, "a1", "Ann")
	second := joinAs(r, "a1", "Ann") // the same person with a second socket
	for _, c := range []*Client{first, first, first, second, second} {
		recv(t, c)
	}
	r.Leave(first)
	// Ann is still here through the second socket
	m := recv(t, second)
	if names := peerNames(m); len(names) != 1 || names[0] != "Ann" {
		t.Fatalf("peers = %v, want [Ann]", names)
	}
}

func TestIdentitiesAreCleaned(t *testing.T) {
	c := NewClient(1)
	c.Identify("  id-1  ", "  "+strings.Repeat("x", 100)+"  ")
	if c.ID != "id-1" {
		t.Fatalf("ID = %q", c.ID)
	}
	if len([]rune(c.Name)) != 40 {
		t.Fatalf("name length = %d, want 40", len([]rune(c.Name)))
	}
	c.Identify(strings.Repeat("i", 100), "Ann")
	if c.ID != "" {
		t.Fatalf("an id that is too long is dropped, got %q", c.ID)
	}
	c.Identify("a1", "   ")
	if c.ID != "" {
		t.Fatalf("a client without a name is anonymous, got %q", c.ID)
	}
}

func TestRenamingIsBroadcastToEveryone(t *testing.T) {
	r := New()
	a, b := join(r), join(r)
	recv(t, a)
	recv(t, b)
	r.SetName("Lekcja 5")
	for _, c := range []*Client{a, b} {
		m := recv(t, c)
		if m["t"] != "name" || m["value"] != "Lekcja 5" {
			t.Fatalf("message = %v", m)
		}
	}
}

func TestTheReservedNameIsRefusedToAClientThatSaysItIsCalledThat(t *testing.T) {
	c := NewClient(1)
	for _, name := range []string{"Administrator", "administrator", " Admin.istrator "} {
		c.Identify("id1", name)
		if c.ID != "" || c.Name != "" {
			t.Errorf("%q was taken: %q", name, c.Name)
		}
	}
	c.Identify("id1", "Ola")
	if c.Name != "Ola" {
		t.Fatalf("a plain name is refused: %q", c.Name)
	}
}

func TestTheAdministratorIsIdentifiedByTheServerOnly(t *testing.T) {
	c := NewClient(1)
	c.IdentifyAdmin("id9")
	if c.ID != "id9" || c.Name != "Administrator" {
		t.Fatalf("got %q %q", c.ID, c.Name)
	}
	c.IdentifyAdmin("")
	if c.ID != "" || c.Name != "" {
		t.Fatalf("an empty id leaves the client anonymous, got %q %q", c.ID, c.Name)
	}
}
