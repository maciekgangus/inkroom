package room

import "testing"

// recordingPeers is the "recording" flag of each person in the newest list of people c got.
func recordingPeers(t *testing.T, c *Client) map[string]bool {
	t.Helper()
	m := last(t, c, "peers")
	if m == nil {
		t.Fatal("no list of people was sent")
	}
	out := map[string]bool{}
	for _, p := range m["peers"].([]any) {
		peer := p.(map[string]any)
		out[peer["id"].(string)], _ = peer["recording"].(bool)
	}
	return out
}

func TestEveryoneIsToldWhenTheOwnerRecords(t *testing.T) {
	// R-094: a red dot for all while the owner records; the server only passes it on.
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	tutor.SetPerson("owner", true)
	drain(tutor)
	drain(student)

	if err := r.Handle(tutor, []byte(`{"t":"recording","on":true}`)); err != nil {
		t.Fatal(err)
	}
	for _, c := range []*Client{tutor, student} {
		if got := recordingPeers(t, c); !got["tutor"] || got["s1"] {
			t.Fatalf("peers after the start: %v", got)
		}
	}
	if err := r.Handle(tutor, []byte(`{"t":"recording","on":false}`)); err != nil {
		t.Fatal(err)
	}
	if got := recordingPeers(t, student); got["tutor"] {
		t.Errorf("still recording after the stop: %v", got)
	}
}

func TestOnlyTheOwnerCanSayItRecords(t *testing.T) {
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	tutor.SetPerson("owner", true)
	student.SetPerson("pupil", false)
	drain(tutor)
	drain(student)
	if err := r.Handle(student, []byte(`{"t":"recording","on":true}`)); err != nil {
		t.Fatal(err)
	}
	none(t, tutor)
	none(t, student)
}

func TestTheDotGoesWhenTheRecordingOwnerLeaves(t *testing.T) {
	r := New()
	tutor, student := identified(r, "tutor", "Anna"), identified(r, "s1", "Bob")
	tutor.SetPerson("owner", true)
	_ = r.Handle(tutor, []byte(`{"t":"recording","on":true}`))
	drain(student)
	r.Leave(tutor) // the tab was closed
	if got := recordingPeers(t, student); got["tutor"] {
		t.Errorf("the owner is gone but the list says they record: %v", got)
	}
}

func TestSomeoneWhoJoinsLaterSeesTheDot(t *testing.T) {
	r := New()
	tutor := identified(r, "tutor", "Anna")
	tutor.SetPerson("owner", true)
	_ = r.Handle(tutor, []byte(`{"t":"recording","on":true}`))
	late := identified(r, "s2", "Cy")
	if got := recordingPeers(t, late); !got["tutor"] {
		t.Errorf("a late joiner does not see the recording: %v", got)
	}
}

func TestTheRecordingFlagIsNotStored(t *testing.T) {
	r := New()
	tutor := identified(r, "tutor", "Anna")
	tutor.SetPerson("owner", true)
	_ = r.Handle(tutor, []byte(`{"t":"recording","on":true}`))
	if ids := strokeIDs(t, recv(t, join(r))); len(ids) != 0 {
		t.Errorf("the flag became a stroke: %v", ids)
	}
}
