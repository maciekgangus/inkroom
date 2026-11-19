package room

import (
	"testing"
	"time"
)

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
	drain(tutor)   // it is told it has a follower
	drain(student) // and everyone whom the student follows now
	drain(other)
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
	for _, c := range []*Client{tutor, s1, s2} {
		drain(c)
	}
	n := func() any {
		m := last(t, tutor, "followers")
		if m == nil {
			t.Fatal("the presenter was not told")
		}
		return m["n"]
	}
	_ = r.Handle(s1, []byte(`{"t":"follow","id":"tutor"}`))
	if got := n(); got != float64(1) {
		t.Fatalf("got %v", got)
	}
	_ = r.Handle(s2, []byte(`{"t":"follow","id":"tutor"}`))
	if got := n(); got != float64(2) {
		t.Fatalf("got %v", got)
	}
	_ = r.Handle(s1, []byte(`{"t":"follow","id":""}`)) // stops following
	if got := n(); got != float64(1) {
		t.Fatalf("got %v", got)
	}
	r.Leave(s2) // leaving stops following too
	if got := n(); got != float64(0) {
		t.Fatalf("got %v", got)
	}
}

func TestViewCannotBePassedOffAsSomeoneElses(t *testing.T) {
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	drain(tutor)
	drain(student)
	_ = r.Handle(student, []byte(`{"t":"follow","id":"tutor"}`))
	drain(tutor)
	drain(student)
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
	drain(student)
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

// last returns the newest message of kind t in c's queue (nil if none), emptying the queue.
func last(t *testing.T, c *Client, kind string) map[string]any {
	t.Helper()
	var got map[string]any
	for len(c.Send) > 0 {
		if m := recv(t, c); m["t"] == kind {
			got = m
		}
	}
	return got
}

func TestAnyoneMayFollowAnyone(t *testing.T) {
	// A student follows a student, a student the tutor, the tutor a student (R-093).
	r := New()
	tutor, s1, s2 := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob"), identified(r, "s2", "Cy")
	tutor.SetPerson("p", true)
	for _, c := range []*Client{tutor, s1, s2} {
		drain(c)
	}
	_ = r.Handle(s1, []byte(`{"t":"follow","id":"s2"}`))
	if m := last(t, s2, "followers"); m == nil || m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
	_ = r.Handle(tutor, []byte(`{"t":"follow","id":"s1"}`))
	if m := last(t, s1, "followers"); m == nil || m["n"] != float64(1) {
		t.Fatalf("got %v", m)
	}
}

func TestACycleOfFollowsIsRefused(t *testing.T) {
	r := New()
	a, b, c := identified(r, "a", "A"), identified(r, "b", "B"), identified(r, "c", "C")
	for _, x := range []*Client{a, b, c} {
		drain(x)
	}
	_ = r.Handle(a, []byte(`{"t":"follow","id":"b"}`))
	_ = r.Handle(b, []byte(`{"t":"follow","id":"c"}`)) // a chain a -> b -> c is fine
	for _, x := range []*Client{a, b, c} {
		drain(x)
	}
	// c -> a would close the circle, and so would b -> a
	_ = r.Handle(c, []byte(`{"t":"follow","id":"a"}`))
	if m := last(t, c, "follow_refused"); m == nil || m["id"] != "a" {
		t.Fatalf("a long cycle was allowed: %v", m)
	}
	_ = r.Handle(b, []byte(`{"t":"follow","id":"a"}`))
	if m := last(t, b, "follow_refused"); m == nil {
		t.Fatal("a short cycle was allowed")
	}
	// the chain still works: c's view reaches b, b's reaches a
	drain(a)
	drain(b)
	_ = r.Handle(b, []byte(`{"t":"view","id":"b","minX":0,"minY":0,"maxX":1,"maxY":1}`))
	if m := recv(t, a); m["t"] != "view" || m["id"] != "b" {
		t.Fatalf("got %v", m)
	}
}

func TestFollowingSomeoneNotHereIsRefused(t *testing.T) {
	r := New()
	a := identified(r, "a", "A")
	drain(a)
	_ = r.Handle(a, []byte(`{"t":"follow","id":"ghost"}`))
	if m := last(t, a, "follow_refused"); m == nil {
		t.Fatal("following someone who is not here was accepted")
	}
}

func TestPeersTellWhomEachOneFollows(t *testing.T) {
	r := New()
	a, b := identified(r, "a", "A"), identified(r, "b", "B")
	drain(a)
	drain(b)
	_ = r.Handle(a, []byte(`{"t":"follow","id":"b"}`))
	m := last(t, b, "peers")
	if m == nil {
		t.Fatal("the others were not told")
	}
	for _, p := range m["peers"].([]any) {
		q := p.(map[string]any)
		if q["id"] == "a" && q["follows"] != "b" {
			t.Fatalf("got %v", q)
		}
		if q["id"] == "b" && q["follows"] != nil {
			t.Fatalf("got %v", q)
		}
	}
	drain(a)
	_ = r.Handle(a, []byte(`{"t":"follow","id":""}`))
	m = last(t, a, "peers")
	for _, p := range m["peers"].([]any) {
		if q := p.(map[string]any); q["follows"] != nil {
			t.Fatalf("still following: %v", q)
		}
	}
}

func TestWhenTheFollowedLeavesFollowingEndsAndDoesNotResume(t *testing.T) {
	r := New()
	a, b := identified(r, "a", "A"), identified(r, "b", "B")
	drain(a)
	drain(b)
	_ = r.Handle(a, []byte(`{"t":"follow","id":"b"}`))
	drain(a)
	r.Leave(b)
	if m := last(t, a, "follow_end"); m == nil || m["id"] != "b" {
		t.Fatalf("the follower was not told: %v", m)
	}
	b2 := identified(r, "b", "B") // comes back: nobody follows them any more
	drain(a)
	drain(b2)
	_ = r.Handle(b2, []byte(`{"t":"view","id":"b","minX":0,"minY":0,"maxX":1,"maxY":1}`))
	none(t, a)
}

func TestOnePersonInTwoTabsKeepsBeingFollowedUntilBothLeave(t *testing.T) {
	r := New()
	a, b, b2 := identified(r, "a", "A"), identified(r, "b", "B"), identified(r, "b", "B")
	for _, x := range []*Client{a, b, b2} {
		drain(x)
	}
	_ = r.Handle(a, []byte(`{"t":"follow","id":"b"}`))
	drain(a)
	r.Leave(b)
	if m := last(t, a, "follow_end"); m != nil {
		t.Fatalf("the other tab is still here: %v", m)
	}
}

func TestViewsAreLimitedToAboutTwentyPerSecond(t *testing.T) {
	r := New()
	now := time.Unix(1000, 0)
	r.now = func() time.Time { return now }
	a, b := identified(r, "a", "A"), identified(r, "b", "B")
	drain(a)
	drain(b)
	_ = r.Handle(a, []byte(`{"t":"follow","id":"b"}`))
	drain(a)
	drain(b)
	v := `{"t":"view","id":"b","minX":0,"minY":0,"maxX":1,"maxY":1}`
	_ = r.Handle(b, []byte(v))
	now = now.Add(10 * time.Millisecond)
	_ = r.Handle(b, []byte(v)) // too soon
	now = now.Add(60 * time.Millisecond)
	_ = r.Handle(b, []byte(v))
	if n := len(a.Send); n != 2 {
		t.Fatalf("%d views reached the follower, want 2", n)
	}
}
