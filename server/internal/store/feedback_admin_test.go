package store

import (
	"errors"
	"testing"
	"time"
)

func TestFeedbackCanBeMarkedReadAndDeleted(t *testing.T) {
	s := open(t)
	if err := s.AddFeedback(Feedback{Person: "g:1", Message: "a", At: time.Now()}); err != nil {
		t.Fatal(err)
	}
	all, _ := s.ListFeedback(10)
	if len(all) != 1 || all[0].Read || all[0].ID == 0 {
		t.Fatalf("new note: %+v", all)
	}
	id := all[0].ID
	if err := s.SetFeedbackRead(id, true); err != nil {
		t.Fatal(err)
	}
	all, _ = s.ListFeedback(10)
	if !all[0].Read {
		t.Fatal("not marked read")
	}
	if err := s.SetFeedbackRead(id, false); err != nil {
		t.Fatal(err)
	}
	all, _ = s.ListFeedback(10)
	if all[0].Read {
		t.Fatal("not marked unread")
	}
	if err := s.DeleteFeedback(id); err != nil {
		t.Fatal(err)
	}
	if all, _ = s.ListFeedback(10); len(all) != 0 {
		t.Fatal("not deleted")
	}
	for name, err := range map[string]error{
		"read":   s.SetFeedbackRead(id, true),
		"delete": s.DeleteFeedback(id),
	} {
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("%s of a missing note = %v, want ErrNotFound", name, err)
		}
	}
}
