package room

import (
	"encoding/json"
	"testing"
)

const addStroke = `{"t":"add","stroke":{"id":"s1","authorId":"x","color":"#111","size":4,"points":[[1,1,0.5]]}}`

// person joins r as an identified client of the given person; owner marks the board's owner.
func person(r *Room, id, who string, owner bool) *Client {
	c := NewClient(32)
	c.Identify(id, id)
	c.SetPerson(who, owner)
	r.Join(c)
	return c
}

func drain(c *Client) {
	for {
		select {
		case <-c.Send:
		default:
			return
		}
	}
}

func perm(t *testing.T, r *Room, from *Client, id string, draw bool) {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"t": "perm", "id": id, "draw": draw})
	if err := r.Handle(from, b); err != nil {
		t.Fatal(err)
	}
}

// mutedOf reads the muted flag of peer id from a peers message.
func mutedOf(m map[string]any, id string) bool {
	for _, p := range m["peers"].([]any) {
		peer := p.(map[string]any)
		if peer["id"] == id {
			v, _ := peer["muted"].(bool)
			return v
		}
	}
	return false
}

func TestOwnerCanTakeAwayDrawingAndEveryoneIsTold(t *testing.T) {
	r := New()
	owner := person(r, "own", "u:1", true)
	ann := person(r, "ann", "g:ann", false)
	drain(owner)
	drain(ann)

	perm(t, r, owner, "ann", false)

	for _, c := range []*Client{owner, ann} {
		m := recv(t, c)
		if m["t"] != "peers" || !mutedOf(m, "ann") || mutedOf(m, "own") {
			t.Fatalf("peers after revoking = %v", m)
		}
	}
}

func TestRevokedPersonCannotChangeTheBoardAndGetsASnapshot(t *testing.T) {
	r := New()
	owner := person(r, "own", "u:1", true)
	ann := person(r, "ann", "g:ann", false)
	perm(t, r, owner, "ann", false)
	drain(owner)
	drain(ann)

	if err := r.Handle(ann, []byte(addStroke)); err != nil {
		t.Fatal(err)
	}
	none(t, owner)
	if m := recv(t, ann); m["t"] != "snapshot" {
		t.Fatalf("revoked client got %v, want a snapshot to undo its local change", m)
	}
	// And the stroke is not there for a newcomer.
	late := join(r)
	if m := recv(t, late); len(m["strokes"].([]any)) != 0 {
		t.Fatalf("snapshot has the rejected stroke: %v", m)
	}
}

func TestRevokedPersonsLiveStrokeIsNotRelayed(t *testing.T) {
	r := New()
	owner := person(r, "own", "u:1", true)
	ann := person(r, "ann", "g:ann", false)
	perm(t, r, owner, "ann", false)
	drain(owner)
	drain(ann)
	_ = r.Handle(ann, []byte(`{"t":"live","id":"s2","authorId":"ann","color":"#111","size":4,"points":[[1,1,0.5]]}`))
	none(t, owner)
}

func TestDrawingCanBeGivenBack(t *testing.T) {
	r := New()
	owner := person(r, "own", "u:1", true)
	ann := person(r, "ann", "g:ann", false)
	perm(t, r, owner, "ann", false)
	perm(t, r, owner, "ann", true)
	drain(owner)
	drain(ann)
	_ = r.Handle(ann, []byte(addStroke))
	if m := recv(t, owner); m["t"] != "add" {
		t.Fatalf("owner got %v, want the add", m)
	}
}

func TestOnlyTheOwnerChangesRights(t *testing.T) {
	r := New()
	person(r, "own", "u:1", true)
	ann := person(r, "ann", "g:ann", false)
	bob := person(r, "bob", "g:bob", false)
	drain(ann)
	drain(bob)
	perm(t, r, ann, "bob", false)
	none(t, bob)
	_ = r.Handle(bob, []byte(addStroke))
	if m := recv(t, ann); m["t"] != "add" {
		t.Fatalf("bob was muted by a non-owner: %v", m)
	}
}

func TestTheOwnerCannotLoseDrawing(t *testing.T) {
	r := New()
	owner := person(r, "own", "u:1", true)
	other := person(r, "ann", "g:ann", false)
	drain(owner)
	drain(other)
	perm(t, r, owner, "own", false)
	none(t, other)
	_ = r.Handle(owner, []byte(addStroke))
	if m := recv(t, other); m["t"] != "add" {
		t.Fatalf("owner was silenced: %v", m)
	}
}

func TestRightsFollowThePersonNotTheTab(t *testing.T) {
	r := New()
	owner := person(r, "own", "u:1", true)
	person(r, "ann", "g:ann", false)
	perm(t, r, owner, "ann", false)
	tab2 := person(r, "ann-tab2", "g:ann", false) // same browser, another tab
	drain(owner)
	drain(tab2)
	_ = r.Handle(tab2, []byte(addStroke))
	none(t, owner)
}

func TestRevokedRightsAreReportedForSaving(t *testing.T) {
	r := New()
	var got []string
	r.OnRevoke = func(who string, revoked bool) {
		if revoked {
			got = append(got, "+"+who)
		} else {
			got = append(got, "-"+who)
		}
	}
	owner := person(r, "own", "u:1", true)
	person(r, "ann", "g:ann", false)
	perm(t, r, owner, "ann", false)
	perm(t, r, owner, "ann", true)
	if len(got) != 2 || got[0] != "+g:ann" || got[1] != "-g:ann" {
		t.Fatalf("saved changes = %v", got)
	}
}

func TestSavedRevocationsApplyFromTheStart(t *testing.T) {
	r := newPersisted(nil, "plain")
	r.setRevoked([]string{"g:ann"})
	owner := person(r, "own", "u:1", true)
	ann := person(r, "ann", "g:ann", false)
	drain(owner)
	drain(ann)
	_ = r.Handle(ann, []byte(addStroke))
	none(t, owner)
	// A newcomer's peers list already shows her as muted.
	late := person(r, "bob", "g:bob", false)
	recv(t, late) // snapshot
	if m := recv(t, late); m["t"] != "peers" || !mutedOf(m, "ann") {
		t.Fatalf("peers = %v", m)
	}
}
