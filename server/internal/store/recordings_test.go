package store

import (
	"errors"
	"testing"
	"time"
)

// finishedRecording makes a recording that is done, at minute `age` after t0.
func finishedRecording(t *testing.T, s *Store, id string, age int) {
	t.Helper()
	u := user(t, s, id+"@example.com")
	if _, err := s.CreateBoard("b"+id, u.ID, "Tablica"); err != nil {
		t.Fatal(err)
	}
	rec := Recording{ID: id, BoardID: "b" + id, UserID: u.ID, Name: "Nagranie", Mime: "audio/webm", Storage: "disk", CreatedAt: t0.Add(time.Duration(age) * time.Minute)}
	if err := s.CreateRecording(rec); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishRecording(id, 60_000, 1000); err != nil {
		t.Fatal(err)
	}
}

func videoOf(t *testing.T, s *Store, id string) Recording {
	t.Helper()
	r, err := s.Recording("b"+id, id)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestVideoWaitsInTheQueueUntilTheRendererTakesItOldestFirst(t *testing.T) {
	s := open(t)
	finishedRecording(t, s, "new", 10)
	finishedRecording(t, s, "old", 0)
	if _, ok, err := s.ClaimVideo(t0); err != nil || ok {
		t.Fatalf("nothing is queued yet: %v %v", ok, err)
	}
	for _, id := range []string{"new", "old"} {
		if err := s.QueueVideo(id); err != nil {
			t.Fatal(err)
		}
	}
	first, ok, err := s.ClaimVideo(t0)
	if err != nil || !ok || first.ID != "old" || first.Video != VideoRendering || first.VideoAttempts != 1 {
		t.Fatalf("got %+v %v %v", first, ok, err)
	}
	second, ok, _ := s.ClaimVideo(t0)
	if !ok || second.ID != "new" {
		t.Fatalf("got %+v %v", second, ok)
	}
	if _, ok, _ := s.ClaimVideo(t0); ok {
		t.Fatal("the queue should be empty")
	}
}

func TestOnlyAFinishedRecordingIsQueuedAndOnlyOnce(t *testing.T) {
	s := open(t)
	u := user(t, s, "a@example.com")
	if _, err := s.CreateBoard("b1", u.ID, "T"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateRecording(Recording{ID: "r1", BoardID: "b1", UserID: u.ID, Name: "N", Mime: "audio/webm", Storage: "disk", CreatedAt: t0}); err != nil {
		t.Fatal(err)
	}
	_ = s.QueueVideo("r1")
	if got, _ := s.Recording("b1", "r1"); got.Video != VideoNone {
		t.Fatalf("an unfinished recording was queued: %q", got.Video)
	}
	_ = s.FinishRecording("r1", 1000, 10)
	_ = s.QueueVideo("r1")
	claimed, _, _ := s.ClaimVideo(t0)
	_ = s.QueueVideo("r1") // already rendering: stays so
	if got, _ := s.Recording("b1", "r1"); got.Video != VideoRendering || claimed.ID != "r1" {
		t.Fatalf("got %q", got.Video)
	}
}

func TestVideoProgressFinishAndFailure(t *testing.T) {
	s := open(t)
	finishedRecording(t, s, "a", 0)
	_ = s.QueueVideo("a")
	if err := s.NoteVideoProgress("a", 50, t0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("progress of a video nobody renders: %v", err)
	}
	_, _, _ = s.ClaimVideo(t0)
	_ = s.NoteVideoProgress("a", 250, t0.Add(time.Minute)) // clamped
	if got := videoOf(t, s, "a"); got.VideoProgress != 100 || !got.VideoAt.Equal(t0.Add(time.Minute)) {
		t.Fatalf("got %+v", got)
	}
	// A failure puts it back in the queue; the third attempt's failure is final.
	for attempt := 1; attempt <= 3; attempt++ {
		if err := s.FailVideo("a", 3); err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
		want := VideoQueued
		if attempt == 3 {
			want = VideoFailed
		}
		if got := videoOf(t, s, "a"); got.Video != want {
			t.Fatalf("after attempt %d: %q, want %q", attempt, got.Video, want)
		}
		if attempt < 3 {
			if _, ok, _ := s.ClaimVideo(t0); !ok {
				t.Fatalf("attempt %d was not queued again", attempt)
			}
		}
	}
	// A finished video is final and only a rendering one can finish.
	finishedRecording(t, s, "b", 1)
	_ = s.QueueVideo("b")
	if err := s.FinishVideo("b", 5); !errors.Is(err, ErrNotFound) {
		t.Fatalf("finishing a video that is not rendering: %v", err)
	}
	_, _, _ = s.ClaimVideo(t0)
	if err := s.FinishVideo("b", 5000); err != nil {
		t.Fatal(err)
	}
	if got := videoOf(t, s, "b"); got.Video != VideoReady || got.VideoBytes != 5000 || got.VideoProgress != 100 {
		t.Fatalf("got %+v", got)
	}
}

func TestARendererThatWentSilentLosesItsJob(t *testing.T) {
	s := open(t)
	finishedRecording(t, s, "a", 0)
	finishedRecording(t, s, "b", 1)
	_ = s.QueueVideo("a")
	_ = s.QueueVideo("b")
	_, _, _ = s.ClaimVideo(t0)                       // a, at t0
	_, _, _ = s.ClaimVideo(t0.Add(20 * time.Minute)) // b, later
	n, err := s.RequeueStaleVideos(t0.Add(10*time.Minute), 3)
	if err != nil || n != 1 {
		t.Fatalf("got %d %v", n, err)
	}
	if a, b := videoOf(t, s, "a"), videoOf(t, s, "b"); a.Video != VideoQueued || b.Video != VideoRendering {
		t.Fatalf("a %q, b %q", a.Video, b.Video)
	}
}
