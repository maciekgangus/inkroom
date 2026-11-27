package recstore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"testing"
	"time"
)

func TestDiskPartsLandAtTheirOffsetsWhateverTheOrder(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	ctx := context.Background()
	full := bytes.Repeat([]byte{'a'}, PartSize)
	// Part 2 (the last, short) arrives before part 1, and part 1 is sent twice (a retry).
	if err := d.WritePart("k.webm", 2, strings.NewReader("tail")); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := d.WritePart("k.webm", 1, bytes.NewReader(full)); err != nil {
			t.Fatal(err)
		}
	}
	size, err := d.Complete(ctx, "k.webm", "")
	if err != nil || size != PartSize+4 {
		t.Fatalf("Complete = %d, %v", size, err)
	}
	f, err := d.Open("k.webm")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, _ := io.ReadAll(f)
	if !bytes.Equal(got, append(full, "tail"...)) {
		t.Errorf("file is %d bytes, not the two parts", len(got))
	}
}

func TestDiskRefusesAPartTooBigOrOutOfRange(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	if err := d.WritePart("k.webm", 1, bytes.NewReader(make([]byte, PartSize+1))); !errors.Is(err, ErrPartTooBig) {
		t.Errorf("part of PartSize+1 bytes: %v", err)
	}
	for _, n := range []int{0, -1, MaxParts + 1} {
		if err := d.WritePart("k.webm", n, strings.NewReader("x")); !errors.Is(err, ErrBadPart) {
			t.Errorf("part %d: %v", n, err)
		}
	}
	if _, err := os.Stat(d.Dir + "/k.webm"); !os.IsNotExist(err) {
		t.Errorf("a refused part left a file: %v", err)
	}
}

func TestDiskCompleteWithoutPartsIsAnEmptyRecording(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	if _, err := d.Complete(context.Background(), "none.webm", ""); !errors.Is(err, ErrNoParts) {
		t.Errorf("= %v, want ErrNoParts", err)
	}
}

func TestDiskRemoveDeletesTheFileAndForgivesAMissingOne(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	_ = d.WritePart("k.webm", 1, strings.NewReader("x"))
	if err := d.Remove(context.Background(), "k.webm", "", true); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Open("k.webm"); !os.IsNotExist(err) {
		t.Errorf("file still there: %v", err)
	}
	if err := d.Remove(context.Background(), "k.webm", "", true); err != nil {
		t.Errorf("removing a missing file: %v", err)
	}
}

func TestDiskKeysCannotLeaveTheDirectory(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	for _, k := range []string{"../x", "a/../../x", "/abs", `a\b`, "", ".", "a/.."} {
		if err := d.WritePart(k, 1, strings.NewReader("x")); !errors.Is(err, ErrBadKey) {
			t.Errorf("key %q: %v", k, err)
		}
	}
}

func TestDiskKeepsAnObjectsOfARecordingUnderItsPrefix(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	ctx := context.Background()
	if err := d.WriteObject("rec1/events/3.json", strings.NewReader(`[1,2]`), 100); err != nil {
		t.Fatal(err)
	}
	if err := d.WritePart("rec1/audio.webm", 1, strings.NewReader("sound")); err != nil {
		t.Fatal(err)
	}
	f, err := d.Open("rec1/events/3.json")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(f)
	f.Close()
	if string(got) != "[1,2]" {
		t.Errorf("object = %q", got)
	}
	if err := d.WriteObject("rec1/events/4.json", strings.NewReader("12345"), 4); !errors.Is(err, ErrTooBig) {
		t.Errorf("an object over the limit: %v", err)
	}
	if err := d.RemoveAll(ctx, "rec1/"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Open("rec1/audio.webm"); !os.IsNotExist(err) {
		t.Errorf("the recording's audio is still there: %v", err)
	}
	if err := d.RemoveAll(ctx, "rec1/"); err != nil {
		t.Errorf("removing what is gone: %v", err)
	}
	if err := d.RemoveAll(ctx, "../"); !errors.Is(err, ErrBadKey) {
		t.Errorf("a prefix outside the directory: %v", err)
	}
}

func TestDiskHasNoDirectAddresses(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	ctx := context.Background()
	if u, err := d.PartURL(ctx, "k", "", 1, time.Minute); u != "" || err != nil {
		t.Errorf("PartURL = %q, %v", u, err)
	}
	if u, err := d.DownloadURL(ctx, "k", "f.webm", "audio/webm", time.Minute); u != "" || err != nil {
		t.Errorf("DownloadURL = %q, %v", u, err)
	}
	if u, err := d.PutURL(ctx, "k", time.Minute); u != "" || err != nil {
		t.Errorf("PutURL = %q, %v", u, err)
	}
	if u, err := d.GetURL(ctx, "k", time.Minute); u != "" || err != nil {
		t.Errorf("GetURL = %q, %v", u, err)
	}
}

// TestS3 runs the whole life of a recording against a real S3-compatible bucket (MinIO, R2). It is
// skipped unless RECSTORE_TEST_S3 is set to "endpoint,bucket,key,secret" (endpoint as for NewS3,
// the bucket must exist).
func TestS3(t *testing.T) {
	cfg := strings.Split(os.Getenv("RECSTORE_TEST_S3"), ",")
	if len(cfg) != 4 {
		t.Skip("RECSTORE_TEST_S3 is not set")
	}
	s, err := NewS3(cfg[0], cfg[1], cfg[2], cfg[3], "")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	key := "recstore-test/" + time.Now().Format("150405.000") + "/audio.webm"
	id, err := s.Start(ctx, key, "video/webm")
	if err != nil || id == "" {
		t.Fatalf("Start = %q, %v", id, err)
	}
	put := func(n int, data []byte) {
		t.Helper()
		u, err := s.PartURL(ctx, key, id, n, time.Minute)
		if err != nil || u == "" {
			t.Fatalf("PartURL(%d) = %q, %v", n, u, err)
		}
		req, _ := http.NewRequest("PUT", u, bytes.NewReader(data))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("PUT part %d = %d", n, resp.StatusCode)
		}
	}
	first := bytes.Repeat([]byte{'a'}, PartSize)
	put(1, first)
	put(2, []byte("tail"))
	size, err := s.Complete(ctx, key, id)
	if err != nil || size != PartSize+4 {
		t.Fatalf("Complete = %d, %v", size, err)
	}
	u, err := s.DownloadURL(ctx, key, "Lekcja 1.webm", "video/webm", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !bytes.Equal(got, append(first, "tail"...)) {
		t.Fatalf("download = %d, %d bytes", resp.StatusCode, len(got))
	}
	if cd := resp.Header.Get("Content-Disposition"); !strings.Contains(cd, "attachment") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if err := s.Remove(ctx, key, id, true); err != nil {
		t.Fatal(err)
	}
	if resp, _ := http.Get(u); resp != nil {
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("download after Remove = %d, want 404", resp.StatusCode)
		}
	}

	// Small objects (the events of a recording) under the same prefix go by a plain signed PUT.
	obj := path.Dir(key) + "/events/1.json"
	pu, err := s.PutURL(ctx, obj, time.Minute)
	if err != nil || pu == "" {
		t.Fatalf("PutURL = %q, %v", pu, err)
	}
	req, _ := http.NewRequest("PUT", pu, strings.NewReader(`[[0,"v"]]`))
	presp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	presp.Body.Close()
	if presp.StatusCode != http.StatusOK {
		t.Fatalf("PUT object = %d", presp.StatusCode)
	}
	gu, err := s.GetURL(ctx, obj, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	gresp, err := http.Get(gu)
	if err != nil {
		t.Fatal(err)
	}
	gbody, _ := io.ReadAll(gresp.Body)
	gresp.Body.Close()
	if gresp.StatusCode != http.StatusOK || string(gbody) != `[[0,"v"]]` {
		t.Fatalf("GET object = %d %q", gresp.StatusCode, gbody)
	}
	if err := s.RemoveAll(ctx, path.Dir(key)+"/"); err != nil {
		t.Fatal(err)
	}
	if resp, _ := http.Get(gu); resp != nil {
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("object after RemoveAll = %d, want 404", resp.StatusCode)
		}
	}

	// An upload nobody finishes, with one part: the sweeper completes it; with none, it is empty.
	key2 := key + ".torn"
	id2, _ := s.Start(ctx, key2, "video/webm")
	if _, err := s.Complete(ctx, key2, id2); !errors.Is(err, ErrNoParts) {
		t.Errorf("Complete without parts = %v, want ErrNoParts", err)
	}
}

func TestAnObjectThatIsTooBigLeavesTheOldOneAndNoLitter(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	if err := d.WriteObject("r/video.mp4", strings.NewReader("old"), 10); err != nil {
		t.Fatal(err)
	}
	if err := d.WriteObject("r/video.mp4", strings.NewReader("far too big"), 10); !errors.Is(err, ErrTooBig) {
		t.Fatalf("got %v, want ErrTooBig", err)
	}
	if got, _ := os.ReadFile(path.Join(d.Dir, "r/video.mp4")); string(got) != "old" {
		t.Errorf("the object is %q, want the old one", got)
	}
	if entries, _ := os.ReadDir(path.Join(d.Dir, "r")); len(entries) != 1 {
		t.Errorf("files left: %v", entries)
	}
}
