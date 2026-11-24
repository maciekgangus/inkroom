package room

import "testing"

// avatarOf reads the avatar of peer id from a peers message ("" when it has none).
func avatarOf(t *testing.T, m map[string]any, id string) string {
	t.Helper()
	for _, p := range m["peers"].([]any) {
		peer := p.(map[string]any)
		if peer["id"] == id {
			v, _ := peer["avatar"].(string)
			return v
		}
	}
	t.Fatalf("no peer %q in %v", id, m)
	return ""
}

func TestPeersCarryTheAvatarOfAnAccount(t *testing.T) {
	r := New()
	ann := NewClient(32)
	ann.Identify("ann", "ann")
	ann.SetPerson("u:1", false)
	ann.Avatar = "fox"
	r.Join(ann)
	bob := person(r, "bob", "g:bob", false)
	m := last(t, bob, "peers")
	if avatarOf(t, m, "ann") != "fox" || avatarOf(t, m, "bob") != "" {
		t.Fatalf("peers = %v", m)
	}
}

func TestAChangedAvatarReachesEveryoneAtOnce(t *testing.T) {
	r := New()
	ann := person(r, "ann", "u:1", false)
	bob := person(r, "bob", "g:bob", false)
	drain(ann)
	drain(bob)

	r.SetAvatar("u:1", "panda")
	for _, c := range []*Client{ann, bob} {
		m := last(t, c, "peers")
		if m == nil || avatarOf(t, m, "ann") != "panda" {
			t.Fatalf("peers after the change = %v", m)
		}
	}
	// Somebody who is not on this board: nothing to tell.
	r.SetAvatar("u:9", "owl")
	if len(bob.Send) != 0 {
		t.Fatal("a change of an absent person was broadcast")
	}
}

func TestTheHubPassesAnAvatarToEveryBoardOfThePerson(t *testing.T) {
	h := hubFor(t, newFake())
	var seen []*Client
	for _, board := range []string{"b1", "b2"} {
		c := NewClient(32)
		c.Identify("ann", "ann")
		c.SetPerson("u:1", false)
		if _, err := h.Join(board, c); err != nil {
			t.Fatal(err)
		}
		drain(c)
		seen = append(seen, c)
	}
	h.SetAvatar("u:1", "owl")
	for _, c := range seen {
		if m := last(t, c, "peers"); m == nil || avatarOf(t, m, "ann") != "owl" {
			t.Fatalf("peers = %v", m)
		}
	}
}
