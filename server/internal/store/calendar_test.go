package store

import (
	"errors"
	"testing"
	"time"
)

var t0 = time.Date(2026, 12, 1, 15, 0, 0, 0, time.UTC)

func lesson(teacher, student User, start time.Time) Lesson {
	return Lesson{TeacherID: teacher.ID, StudentID: student.ID, Title: "Matma", Start: start, End: start.Add(time.Hour)}
}

func TestLessonIsSeenByBothAndOverlapsAreRefused(t *testing.T) {
	s := open(t)
	a, b, c := user(t, s, "a@example.com"), user(t, s, "b@example.com"), user(t, s, "c@example.com")
	l, err := s.CreateLesson(lesson(a, b, t0), t0)
	if err != nil || l.TeacherName == "" || l.StudentName == "" {
		t.Fatalf("got %+v %v", l, err)
	}
	for _, u := range []User{a, b} {
		got, err := s.LessonsOf(u.ID, t0.Add(-time.Hour), t0.Add(24*time.Hour))
		if err != nil || len(got) != 1 {
			t.Fatalf("user %d: %v %v", u.ID, got, err)
		}
	}
	if got, _ := s.LessonsOf(c.ID, t0.Add(-time.Hour), t0.Add(24*time.Hour)); len(got) != 0 {
		t.Fatalf("a stranger sees %v", got)
	}
	// Overlaps the first lesson from the side of the student, who now teaches somebody else.
	if _, err := s.CreateLesson(lesson(c, b, t0.Add(30*time.Minute)), t0); !errors.Is(err, ErrConflict) {
		t.Fatalf("overlap: got %v", err)
	}
	// Back to back is fine.
	if _, err := s.CreateLesson(lesson(c, b, t0.Add(time.Hour)), t0); err != nil {
		t.Fatalf("adjacent: %v", err)
	}
}

func TestCancelledLessonFreesTheTimeAndRestoringChecksAgain(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	l, _ := s.CreateLesson(lesson(a, b, t0), t0)
	cancelled := LessonCancelled
	if _, err := s.UpdateLesson(l.ID, LessonPatch{Status: &cancelled}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateLesson(lesson(a, b, t0), t0); err != nil {
		t.Fatalf("time not freed: %v", err)
	}
	scheduled := LessonScheduled
	if _, err := s.UpdateLesson(l.ID, LessonPatch{Status: &scheduled}); !errors.Is(err, ErrConflict) {
		t.Fatalf("restore: got %v", err)
	}
}

func TestUpdateChangesOnlyWhatIsGiven(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	l, _ := s.CreateLesson(lesson(a, b, t0), t0)
	note, done := "Ułamki", LessonDone
	got, err := s.UpdateLesson(l.ID, LessonPatch{Note: &note, Status: &done})
	if err != nil || got.Note != "Ułamki" || got.Status != LessonDone || got.Title != "Matma" || !got.Start.Equal(t0) {
		t.Fatalf("got %+v %v", got, err)
	}
	if _, err := s.UpdateLesson(999, LessonPatch{Note: &note}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
}

func TestUnavailablePeriodsBlockLessonsBothWays(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	if _, err := s.AddUnavailable(Unavailable{UserID: b.ID, Start: t0, End: t0.Add(2 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateLesson(lesson(a, b, t0.Add(30*time.Minute)), t0); !errors.Is(err, ErrConflict) {
		t.Fatalf("lesson in unavailable time: %v", err)
	}
	l, _ := s.CreateLesson(lesson(a, b, t0.Add(3*time.Hour)), t0)
	if _, err := s.AddUnavailable(Unavailable{UserID: a.ID, Start: l.Start, End: l.End}); !errors.Is(err, ErrConflict) {
		t.Fatalf("unavailable over a lesson: %v", err)
	}
	list, _ := s.UnavailableOf(b.ID, t0, t0.Add(24*time.Hour))
	if len(list) != 1 {
		t.Fatalf("got %v", list)
	}
	if err := s.DeleteUnavailable(list[0].ID, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("somebody else's period: %v", err)
	}
	if err := s.DeleteUnavailable(list[0].ID, b.ID); err != nil {
		t.Fatal(err)
	}
}

func TestSeriesIsAllOrNothingAndCanBeCutFromADay(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	week := 7 * 24 * time.Hour
	spans := [][2]time.Time{{t0, t0.Add(time.Hour)}, {t0.Add(week), t0.Add(week + time.Hour)}, {t0.Add(2 * week), t0.Add(2*week + time.Hour)}}
	// The third lesson meets an existing one: nothing is created.
	if _, err := s.CreateLesson(lesson(a, b, t0.Add(2*week)), t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateSeries(a.ID, b.ID, "Cykl", "{}", spans, t0); !errors.Is(err, ErrConflict) {
		t.Fatalf("got %v", err)
	}
	if got, _ := s.LessonsOf(a.ID, t0.Add(-time.Hour), t0.Add(3*week)); len(got) != 1 {
		t.Fatalf("a failed series left %d lessons", len(got))
	}
	id, err := s.CreateSeries(a.ID, b.ID, "Cykl", "{}", spans[:2], t0)
	if err != nil {
		t.Fatal(err)
	}
	if owner, _ := s.SeriesOwner(id); owner != a.ID {
		t.Fatalf("owner %d", owner)
	}
	n, err := s.DeleteSeriesFrom(id, t0.Add(week))
	if err != nil || n != 1 {
		t.Fatalf("cut: %d %v", n, err)
	}
	if _, err := s.DeleteSeriesFrom(id, t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SeriesOwner(id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty series should be gone: %v", err)
	}
}

func TestRequestMovesTheLessonWhenAccepted(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	l, _ := s.CreateLesson(lesson(a, b, t0), t0)
	newStart := t0.Add(24 * time.Hour)
	r, err := s.CreateRequest(Request{LessonID: l.ID, ProposerID: b.ID, ResponderID: a.ID, NewStart: newStart, NewEnd: newStart.Add(time.Hour), Note: "choroba"}, t0)
	if err != nil || r.Status != RequestPending || r.ProposerName == "" {
		t.Fatalf("got %+v %v", r, err)
	}
	if _, err := s.CreateRequest(Request{LessonID: l.ID, ProposerID: a.ID, ResponderID: b.ID, NewStart: newStart.Add(time.Hour), NewEnd: newStart.Add(2 * time.Hour)}, t0); !errors.Is(err, ErrConflict) {
		t.Fatalf("second pending request: %v", err)
	}
	for _, u := range []User{a, b} {
		if got, _ := s.RequestsOf(u.ID); len(got) != 1 {
			t.Fatalf("user %d sees %d requests", u.ID, len(got))
		}
	}
	if err := s.ResolveRequest(r.ID, RequestAccepted, t0); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Lesson(l.ID); !got.Start.Equal(newStart) {
		t.Fatalf("lesson at %v", got.Start)
	}
	if err := s.ResolveRequest(r.ID, RequestRejected, t0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("closing twice: %v", err)
	}
	if got, _ := s.RequestsOf(a.ID); len(got) != 0 {
		t.Fatalf("closed request still listed")
	}
}

func TestAcceptingFailsWhenTheTimeWasTakenMeanwhile(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	l, _ := s.CreateLesson(lesson(a, b, t0), t0)
	newStart := t0.Add(24 * time.Hour)
	r, _ := s.CreateRequest(Request{LessonID: l.ID, ProposerID: b.ID, ResponderID: a.ID, NewStart: newStart, NewEnd: newStart.Add(time.Hour)}, t0)
	if _, err := s.CreateLesson(lesson(a, b, newStart), t0); err != nil {
		t.Fatal(err)
	}
	if err := s.ResolveRequest(r.ID, RequestAccepted, t0); !errors.Is(err, ErrConflict) {
		t.Fatalf("got %v", err)
	}
	if err := s.ResolveRequest(r.ID, RequestRejected, t0); err != nil {
		t.Fatalf("rejecting after a conflict: %v", err)
	}
}

func TestBoardLinkSurvivesAndIsDroppedWithTheBoard(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	l, _ := s.CreateLesson(lesson(a, b, t0), t0)
	if _, err := s.CreateBoard("boardid", a.ID, "Matma"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetLessonBoard(l.ID, "boardid"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Lesson(l.ID); got.BoardID != "boardid" {
		t.Fatalf("got %q", got.BoardID)
	}
	if err := s.DeleteBoard("boardid"); err != nil {
		t.Fatal(err)
	}
	if got, err := s.Lesson(l.ID); err != nil || got.BoardID != "" {
		t.Fatalf("lesson after board delete: %+v %v", got, err)
	}
}

func TestDeletingAnAccountRemovesItsLessons(t *testing.T) {
	s := open(t)
	a, b := user(t, s, "a@example.com"), user(t, s, "b@example.com")
	l, _ := s.CreateLesson(lesson(a, b, t0), t0)
	if _, err := s.db.Exec("DELETE FROM users WHERE id = ?", b.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Lesson(l.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v", err)
	}
}
