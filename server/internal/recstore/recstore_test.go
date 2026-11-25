package recstore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
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
	for _, k := range []string{"../x", "a/b", `a\b`, "", "."} {
		if err := d.WritePart(k, 1, strings.NewReader("x")); !errors.Is(err, ErrBadKey) {
			t.Errorf("key %q: %v", k, err)
		}
	}
}

func TestDiskHasNoDirectAddresses(t *testing.T) {
	d := &Disk{Dir: t.TempDir()}
	ctx := context.Background()
	if u, err := d.PartURL(ctx, "k", "", 1, time.Minute); u != "" || err != nil {
		t.Errorf("PartURL = %q, %v", u, err)
	}
	if u, err := d.DownloadURL(ctx, "k", "f.webm", "video/webm", time.Minute); u != "" || err != nil {
		t.Errorf("DownloadURL = %q, %v", u, err)
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
	key := "recstore-test/" + time.Now().Format("150405.000") + ".webm"
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

	// An upload nobody finishes, with one part: the sweeper completes it; with none, it is empty.
	key2 := key + ".torn"
	id2, _ := s.Start(ctx, key2, "video/webm")
	if _, err := s.Complete(ctx, key2, id2); !errors.Is(err, ErrNoParts) {
		t.Errorf("Complete without parts = %v, want ErrNoParts", err)
	}
}
