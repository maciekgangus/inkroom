package room

import "testing"

// identified joins an identified client and drains what it was sent on joining.
func identified(r *Room, id, name string) *Client {
	c := NewClient(32)
	c.Identify(id, name)
	r.Join(c)
	return c
}

const viewMsg = `{"t":"view","id":"tutor","minX":0,"minY":0,"maxX":800,"maxY":600}`

func TestViewGoesToFollowersOnlyAndIsNotStored(t *testing.T) {
	r := New()
	tutor, student, other := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob"), identified(r, "s2", "Cy")
	drain(tutor)
	drain(student)
	drain(other)
	if err := r.Handle(student, []byte(`{"t":"follow","id":"tutor"}`)); err != nil {
		t.Fatal(err)
	}
	drain(tutor) // it is told it has a follower
	if err := r.Handle(tutor, []byte(viewMsg)); err != nil {
		t.Fatal(err)
	}
	m := recv(t, student)
	if m["t"] != "view" || m["id"] != "tutor" || m["maxX"] != float64(800) {
		t.Fatalf("got %v", m)
	}
	none(t, other)
	none(t, tutor)
	if ids := strokeIDs(t, recv(t, join(r))); len(ids) != 0 {
		t.Fatalf("the view was stored: %v", ids)
	}
}

func TestViewWithoutFollowersGoesNowhere(t *testing.T) {
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	drain(tutor)
	drain(student)
	if err := r.Handle(tutor, []byte(viewMsg)); err != nil {
		t.Fatal(err)
	}
	none(t, student)
	none(t, tutor)
}

func TestThePresenterIsToldHowManyFollowThem(t *testing.T) {
	r := New()
	tutor, s1, s2 := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob"), identified(r, "s2", "Cy")
	drain(tutor)
	drain(s1)
	drain(s2)
	_ = r.Handle(s1, []byte(`{"t":"follow","id":"tutor"}`))
	if m := recv(t, tutor); m["t"] != "followers" || m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	_ = r.Handle(s2, []byte(`{"t":"follow","id":"tutor"}`))
	if m := recv(t, tutor); m["n"] != float64(2) {
		t.Fatalf("got %v", m)
	}
	_ = r.Handle(s1, []byte(`{"t":"follow","id":""}`)) // stops following
	if m := recv(t, tutor); m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	r.Leave(s2) // leaving stops following too
	var last map[string]any
	for len(tutor.Send) > 0 {
		if m := recv(t, tutor); m["t"] == "followers" {
			last = m
		}
	}
	if last["t"] != "followers" || last["n"] != float64(0) {
		t.Fatalf("got %v", last)
	}
}

func TestViewCannotBePassedOffAsSomeoneElses(t *testing.T) {
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	drain(tutor)
	drain(student)
	_ = r.Handle(student, []byte(`{"t":"follow","id":"tutor"}`))
	drain(tutor)
	// The student pretends to be the tutor: nobody follows the student, so nothing goes out.
	_ = r.Handle(student, []byte(viewMsg))
	none(t, tutor)
	none(t, student)
}

func TestInviteGoesToEveryoneElseFromTheOwnerOnly(t *testing.T) {
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	tutor.SetPerson("p", true)
	drain(tutor)
	drain(student)
	_ = r.Handle(student, []byte(`{"t":"invite","id":"s1"}`))
	none(t, tutor)
	_ = r.Handle(tutor, []byte(`{"t":"invite","id":"tutor"}`))
	if m := recv(t, student); m["t"] != "invite" || m["id"] != "tutor" {
		t.Fatalf("got %v", m)
	}
	none(t, tutor)
}

func TestFollowAndViewWorkForSomeoneWhoMayNotDraw(t *testing.T) {
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	r.setRevoked([]string{"p"})
	student.SetPerson("p", false)
	drain(tutor)
	drain(student)
	_ = r.Handle(student, []byte(`{"t":"follow","id":"tutor"}`))
	drain(tutor)
	_ = r.Handle(tutor, []byte(viewMsg))
	if m := recv(t, student); m["t"] != "view" {
		t.Fatalf("got %v", m)
	}
}

func TestInvalidFollowAndViewAreRejected(t *testing.T) {
	r := New()
	a := identified(r, "a", "Anna")
	drain(a)
	long := make([]byte, 80)
	for i := range long {
		long[i] = 'x'
	}
	if err := r.Handle(a, []byte(`{"t":"follow","id":"`+string(long)+`"}`)); err == nil {
		t.Fatal("a too long id was accepted")
	}
	if err := r.Handle(a, []byte(`{"t":"view","id":""}`)); err == nil {
		t.Fatal("a view without an id was accepted")
	}
}
