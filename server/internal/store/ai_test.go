package store

import (
	"errors"
	"testing"
	"time"
)

func TestAIJobLifecycle(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if _, err := s.CreateBoard("b1", u.ID, "Board"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LatestAIJob("b1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no job yet: got %v", err)
	}
	t0 := time.Unix(1_800_000_000, 0)
	id, err := s.StartAIJob("b1", t0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartAIJob("b1", t0); !errors.Is(err, ErrConflict) {
		t.Fatalf("second job while running: got %v", err)
	}
	j, err := s.LatestAIJob("b1")
	if err != nil || j.ID != id || j.Status != AIRunning || !j.CreatedAt.Equal(t0) {
		t.Fatalf("running job: %+v %v", j, err)
	}
	segs := []AISegment{
		{ID: "s1", ElementIDs: []string{"e1", "e2"}, MinX: 1, MinY: 2, MaxX: 3, MaxY: 4, Latex: `x^2`},
		{ID: "s2", ElementIDs: []string{"e3"}, Latex: "Zadanie 1", Verbatim: true},
		{ID: "s3", ElementIDs: []string{"e4"}, Error: "timeout"},
	}
	if err := s.FinishAIJob(id, "uni-mumer", segs, t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	j, err = s.LatestAIJob("b1")
	if err != nil || j.Status != AIDone || j.Model != "uni-mumer" || !j.FinishedAt.Equal(t0.Add(time.Minute)) {
		t.Fatalf("done job: %+v %v", j, err)
	}
	if len(j.Segments) != 3 || j.Segments[0].ID != "s1" || j.Segments[0].ElementIDs[1] != "e2" ||
		j.Segments[0].MaxY != 4 || j.Segments[0].Latex != "x^2" || !j.Segments[1].Verbatim ||
		j.Segments[2].Error != "timeout" {
		t.Fatalf("segments: %+v", j.Segments)
	}

	// A new job replaces the old one, with its segments.
	id2, err := s.StartAIJob("b1", t0.Add(time.Hour))
	if err != nil || id2 == id {
		t.Fatalf("new job: %d %v", id2, err)
	}
	if err := s.FailAIJob(id2, "segmentsvc down", t0.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	j, err = s.LatestAIJob("b1")
	if err != nil || j.ID != id2 || j.Status != AIFailed || j.Error != "segmentsvc down" || len(j.Segments) != 0 {
		t.Fatalf("failed job: %+v %v", j, err)
	}
	var n int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM ai_segments").Scan(&n); err != nil || n != 0 {
		t.Fatalf("old segments kept: %d %v", n, err)
	}
}

func TestFailRunningAIJobs(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if _, err := s.CreateBoard("b1", u.ID, "Board"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartAIJob("b1", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := s.FailRunningAIJobs("interrupted", time.Now()); err != nil {
		t.Fatal(err)
	}
	j, err := s.LatestAIJob("b1")
	if err != nil || j.Status != AIFailed || j.Error != "interrupted" {
		t.Fatalf("got %+v %v", j, err)
	}
	if _, err := s.StartAIJob("b1", time.Now()); err != nil {
		t.Fatalf("a failed job must not block a new one: %v", err)
	}
}

func TestAIJobsGoWithTheBoard(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if _, err := s.CreateBoard("b1", u.ID, "Board"); err != nil {
		t.Fatal(err)
	}
	id, _ := s.StartAIJob("b1", time.Now())
	if err := s.FinishAIJob(id, "m", []AISegment{{ID: "s1", ElementIDs: []string{"e1"}}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteBoard("b1"); err != nil {
		t.Fatal(err)
	}
	var jobs, segs int
	s.db.QueryRow("SELECT COUNT(*) FROM ai_jobs").Scan(&jobs)
	s.db.QueryRow("SELECT COUNT(*) FROM ai_segments").Scan(&segs)
	if jobs != 0 || segs != 0 {
		t.Fatalf("left behind: %d jobs, %d segments", jobs, segs)
	}
}

func TestStartAIJobUnknownBoard(t *testing.T) {
	s := open(t)
	if _, err := s.StartAIJob("nope", time.Now()); err == nil {
		t.Fatal("job for a missing board was created")
	}
}
