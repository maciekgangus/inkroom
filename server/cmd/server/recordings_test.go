package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/recstore"
	"github.com/maciekgangus/inkroom/server/internal/store"
)

// Lesson recording (R-094, R-117): the owner of a board records it; the video goes to a bucket
// through signed addresses, or, with no bucket, to a file the app writes.

// fakeBucket is a recstore.Backend that only remembers what it was asked.
type fakeBucket struct {
	mu           sync.Mutex
	started      []string // key
	completed    []string
	removed      []string // "key completed=bool"
	prefixes     []string // removed with everything under them
	completeSize int64
	completeErr  error
	startErr     error
}

func (f *fakeBucket) Name() string { return "s3" }
func (f *fakeBucket) Start(_ context.Context, key, mime string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.startErr != nil {
		return "", f.startErr
	}
	f.started = append(f.started, key+" "+mime)
	return "upload-" + key, nil
}
func (f *fakeBucket) PartURL(_ context.Context, key, id string, n int, _ time.Duration) (string, error) {
	return fmt.Sprintf("https://bucket.test/%s?uploadId=%s&partNumber=%d", key, id, n), nil
}
func (f *fakeBucket) Complete(_ context.Context, key, id string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.completeErr != nil {
		return 0, f.completeErr
	}
	f.completed = append(f.completed, key+" "+id)
	return f.completeSize, nil
}
func (f *fakeBucket) Remove(_ context.Context, key, _ string, completed bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, fmt.Sprintf("%s completed=%v", key, completed))
	return nil
}
func (f *fakeBucket) PutURL(_ context.Context, key string, _ time.Duration) (string, error) {
	return "https://bucket.test/" + key + "?put", nil
}
func (f *fakeBucket) GetURL(_ context.Context, key string, _ time.Duration) (string, error) {
	return "https://bucket.test/" + key + "?get", nil
}
func (f *fakeBucket) RemoveAll(_ context.Context, prefix string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.prefixes = append(f.prefixes, prefix)
	return nil
}
func (f *fakeBucket) DownloadURL(_ context.Context, key, filename, mime string, _ time.Duration) (string, error) {
	return "https://bucket.test/" + key + "?name=" + filename + "&type=" + mime, nil
}

// withBucket makes the app keep new recordings in a fake bucket.
func withBucket(a *app) *fakeBucket {
	f := &fakeBucket{completeSize: 1234}
	a.configureRecordings(a.recDir(), f)
	return f
}

func recPath(boardID, recID, suffix string) string {
	return "/api/boards/" + boardID + "/recordings/" + recID + suffix
}

func decodeList(t *testing.T, resp *http.Response) []map[string]any {
	t.Helper()
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var out []map[string]any
	if resp.StatusCode != http.StatusOK || json.Unmarshal(b, &out) != nil {
		t.Fatalf("list = %d %q", resp.StatusCode, b)
	}
	return out
}

func startRecording(t *testing.T, srv *httptest.Server, boardID string, u *user, mime string) string {
	t.Helper()
	resp := call(t, srv, "POST", "/api/boards/"+boardID+"/recordings", `{"name":"Lekcja","mime":"`+mime+`"}`, u)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("start recording = %d", resp.StatusCode)
	}
	m := decode(t, resp)
	if m["partSize"] != float64(recstore.PartSize) {
		t.Errorf("partSize = %v", m["partSize"])
	}
	id, _ := m["id"].(string)
	if len(id) != 32 {
		t.Fatalf("bad recording id %q", id)
	}
	return id
}

// partAddress asks where to send part n and returns the address.
func partAddress(t *testing.T, srv *httptest.Server, boardID, recID string, n int, u *user) string {
	t.Helper()
	resp := call(t, srv, "POST", fmt.Sprintf("%s/%d", recPath(boardID, recID, "/parts"), n), "", u)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("part address = %d", resp.StatusCode)
	}
	m := decode(t, resp)
	if m["method"] != "PUT" {
		t.Errorf("method = %v", m["method"])
	}
	return m["url"].(string)
}

func putTo(t *testing.T, srv *httptest.Server, address string, data []byte, u *user) *http.Response {
	t.Helper()
	req, err := http.NewRequest("PUT", srv.URL+address, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if u != nil {
		req.AddCookie(u.cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func finishRecording(t *testing.T, srv *httptest.Server, boardID, recID string, ms int, u *user) int {
	t.Helper()
	return status(call(t, srv, "POST", recPath(boardID, recID, "/finish"), fmt.Sprintf(`{"durationMs":%d}`, ms), u))
}

func TestRecordingOnDiskIsSentInPartsAndDownloaded(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm;codecs=opus")

	first := bytes.Repeat([]byte{'A'}, recstore.PartSize)
	addr := partAddress(t, srv, board, rec, 1, &owner)
	if addr != recPath(board, rec, "/parts/1") {
		t.Errorf("without a bucket the part goes to the app: %q", addr)
	}
	if got := status(putTo(t, srv, addr, first, &owner)); got != http.StatusNoContent {
		t.Fatalf("part 1 = %d", got)
	}
	if got := status(putTo(t, srv, partAddress(t, srv, board, rec, 2, &owner), []byte("tail"), &owner)); got != http.StatusNoContent {
		t.Fatalf("part 2 = %d", got)
	}
	if got := finishRecording(t, srv, board, rec, 65000, &owner); got != http.StatusNoContent {
		t.Fatalf("finish = %d", got)
	}

	resp := call(t, srv, "GET", recPath(board, rec, ""), "", &owner)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !bytes.Equal(body, append(first, "tail"...)) {
		t.Fatalf("download = %d, %d bytes", resp.StatusCode, len(body))
	}
	if ct := resp.Header.Get("Content-Type"); ct != "audio/webm" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := resp.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") || !strings.Contains(cd, ".webm") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}

	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &owner))
	if len(list) != 1 {
		t.Fatalf("list = %v", list)
	}
	r := list[0]
	if r["id"] != rec || r["name"] != "Lekcja" || r["bytes"] != float64(recstore.PartSize+4) || r["durationMs"] != float64(65000) || r["finished"] != true {
		t.Errorf("listed recording = %v", r)
	}
}

func TestMP4RecordingKeepsItsType(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/mp4;codecs=mp4a.40.2")
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &owner), []byte("x"), &owner))
	finishRecording(t, srv, board, rec, 1000, &owner)
	resp := call(t, srv, "GET", recPath(board, rec, ""), "", &owner)
	resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "audio/mp4" {
		t.Errorf("Content-Type = %q, want audio/mp4", ct)
	}
	if cd := resp.Header.Get("Content-Disposition"); !strings.Contains(cd, ".mp4") {
		t.Errorf("Content-Disposition = %q", cd)
	}
}

func TestOnlyTheBoardOwnerRecordsAndDeletes(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &owner), []byte("x"), &owner))

	for name, who := range map[string]*user{"another account": &other, "a guest": nil} {
		want := http.StatusForbidden
		if who == nil {
			want = http.StatusUnauthorized
		}
		for what, resp := range map[string]*http.Response{
			"start":   call(t, srv, "POST", "/api/boards/"+board+"/recordings", `{"mime":"audio/webm"}`, who),
			"address": call(t, srv, "POST", recPath(board, rec, "/parts/1"), "", who),
			"part":    putTo(t, srv, recPath(board, rec, "/parts/1"), []byte("evil"), who),
			"finish":  call(t, srv, "POST", recPath(board, rec, "/finish"), `{"durationMs":1}`, who),
			"delete":  call(t, srv, "DELETE", recPath(board, rec, ""), "", who),
		} {
			if got := status(resp); got != want {
				t.Errorf("%s by %s = %d, want %d", what, name, got, want)
			}
		}
	}
}

func TestEveryoneWithTheBoardListsAndDownloadsEvenAGuest(t *testing.T) {
	// R-094: the list and the download need only access to the board (R-003), no account.
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &owner), []byte("hi"), &owner))
	finishRecording(t, srv, board, rec, 1000, &owner)

	if list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", nil)); len(list) != 1 {
		t.Errorf("a guest sees %v", list)
	}
	resp := call(t, srv, "GET", recPath(board, rec, ""), "", nil)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "hi" {
		t.Errorf("a guest downloads %d %q", resp.StatusCode, body)
	}
}

func TestRecordingMustBeVideoOfAKnownType(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	for _, mime := range []string{"", "text/html", "image/png", "video/webm", "audio/x-flv"} {
		if got := status(call(t, srv, "POST", "/api/boards/"+board+"/recordings", `{"mime":"`+mime+`"}`, &u)); got != http.StatusBadRequest {
			t.Errorf("mime %q = %d, want 400", mime, got)
		}
	}
}

func TestRecordingOfAMissingBoardIsNotFound(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	if got := status(call(t, srv, "POST", "/api/boards/"+strings.Repeat("0", 32)+"/recordings", `{"mime":"audio/webm"}`, &u)); got != http.StatusNotFound {
		t.Errorf("= %d, want 404", got)
	}
}

func TestRecordingIsReachedOnlyThroughItsOwnBoard(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	one := createBoard(t, srv, u, "Jeden")
	two := createBoard(t, srv, u, "Dwa")
	rec := startRecording(t, srv, one, &u, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, one, rec, 1, &u), []byte("x"), &u))

	if got := status(call(t, srv, "GET", recPath(two, rec, ""), "", &u)); got != http.StatusNotFound {
		t.Errorf("download through another board = %d, want 404", got)
	}
	if got := status(call(t, srv, "POST", recPath(two, rec, "/parts/1"), "", &u)); got != http.StatusNotFound {
		t.Errorf("part address through another board = %d, want 404", got)
	}
	if got := status(call(t, srv, "DELETE", recPath(two, rec, ""), "", &u)); got != http.StatusNotFound {
		t.Errorf("delete through another board = %d, want 404", got)
	}
	if list := decodeList(t, call(t, srv, "GET", "/api/boards/"+two+"/recordings", "", &u)); len(list) != 0 {
		t.Errorf("the other board lists %v", list)
	}
}

func TestPartNumbersAndSizesAreChecked(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "audio/webm")
	for _, n := range []string{"0", "-1", "10001", "x"} {
		if got := status(call(t, srv, "POST", recPath(board, rec, "/parts/"+n), "", &u)); got != http.StatusBadRequest {
			t.Errorf("address of part %s = %d, want 400", n, got)
		}
	}
	if got := status(putTo(t, srv, recPath(board, rec, "/parts/1"), make([]byte, recstore.PartSize+1), &u)); got != http.StatusRequestEntityTooLarge {
		t.Errorf("a part over the part size = %d, want 413", got)
	}
}

func TestNoPartAfterTheRecordingIsFinishedOrTooOld(t *testing.T) {
	srv, a, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")

	done := startRecording(t, srv, board, &u, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, board, done, 1, &u), []byte("x"), &u))
	finishRecording(t, srv, board, done, 1, &u)
	if got := status(call(t, srv, "POST", recPath(board, done, "/parts/2"), "", &u)); got != http.StatusConflict {
		t.Errorf("part of a finished recording = %d, want 409", got)
	}

	old := strings.Repeat("b", 32)
	if err := a.st.CreateRecording(store.Recording{ID: old, BoardID: board, Name: "Stare", Mime: "audio/webm", Storage: "disk",
		CreatedAt: time.Now().Add(-maxRecordingAge - time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if got := status(call(t, srv, "POST", recPath(board, old, "/parts/1"), "", &u)); got != http.StatusConflict {
		t.Errorf("part of a recording past the limit = %d, want 409", got)
	}
}

func TestFinishingWithNothingSentLeavesNoRecording(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "audio/webm")
	if got := finishRecording(t, srv, board, rec, 500, &u); got != http.StatusNoContent {
		t.Fatalf("finish = %d", got)
	}
	if list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &u)); len(list) != 0 {
		t.Errorf("an empty recording is listed: %v", list)
	}
}

func TestUnfinishedRecordingIsListedAsSuch(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &u), []byte("12345"), &u))
	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &u))
	if len(list) != 1 || list[0]["finished"] != false {
		t.Errorf("list = %v", list)
	}
	if got := status(call(t, srv, "GET", recPath(board, rec, ""), "", &u)); got != http.StatusConflict {
		t.Errorf("download of a recording in progress = %d, want 409", got)
	}
}

func TestDeletingARecordingRemovesItsFile(t *testing.T) {
	srv, a, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &u), []byte("data"), &u))
	file := filepath.Join(a.recDir(), rec+"/audio.webm")
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("the file is not where it should be: %v", err)
	}
	if got := status(call(t, srv, "DELETE", recPath(board, rec, ""), "", &u)); got != http.StatusNoContent {
		t.Fatalf("delete = %d", got)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Errorf("the file is still there: %v", err)
	}
	if got := status(call(t, srv, "GET", recPath(board, rec, ""), "", &u)); got != http.StatusNotFound {
		t.Errorf("download after delete = %d, want 404", got)
	}
}

func TestDeletingABoardRemovesItsRecordingFiles(t *testing.T) {
	srv, a, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &u), []byte("data"), &u))

	if got := status(call(t, srv, "DELETE", "/api/boards/"+board, "", &u)); got != http.StatusNoContent {
		t.Fatalf("delete board = %d", got)
	}
	if _, err := os.Stat(filepath.Join(a.recDir(), rec+"/audio.webm")); !os.IsNotExist(err) {
		t.Errorf("the file is still there: %v", err)
	}
}

func TestSweepFinishesIdleRecordingsAndDropsEmptyOnes(t *testing.T) {
	srv, a, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")

	torn := startRecording(t, srv, board, &u, "audio/webm") // the tab was closed after a part
	status(putTo(t, srv, partAddress(t, srv, board, torn, 1, &u), []byte("abc"), &u))
	empty := startRecording(t, srv, board, &u, "audio/webm") // nothing ever arrived
	fresh := startRecording(t, srv, board, &u, "audio/webm") // still recording

	later := time.Now().Add(idleRecording + time.Minute)
	if err := a.st.TouchRecording(fresh, later); err != nil { // a part came just now
		t.Fatal(err)
	}
	a.sweepRecordings(context.Background(), later)

	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &u))
	byID := map[string]map[string]any{}
	for _, r := range list {
		byID[r["id"].(string)] = r
	}
	if r := byID[torn]; r == nil || r["finished"] != true || r["bytes"] != float64(3) {
		t.Errorf("the torn recording = %v", r)
	}
	if byID[empty] != nil {
		t.Errorf("the empty recording is kept: %v", byID[empty])
	}
	if r := byID[fresh]; r == nil || r["finished"] != false {
		t.Errorf("the recording in progress was touched: %v", r)
	}
}

// --- with a bucket -------------------------------------------------------------------------------

func TestWithABucketPartsGoStraightToIt(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm;codecs=opus")
	key := rec + "/audio.webm"

	if len(bucket.started) != 1 || bucket.started[0] != key+" audio/webm" {
		t.Fatalf("upload started as %v", bucket.started)
	}
	want := fmt.Sprintf("https://bucket.test/%s?uploadId=upload-%s&partNumber=3", key, key)
	if got := partAddress(t, srv, board, rec, 3, &owner); got != want {
		t.Errorf("part address = %q, want %q", got, want)
	}
	// The app takes no audio in this mode.
	if got := status(putTo(t, srv, recPath(board, rec, "/parts/1"), []byte("x"), &owner)); got != http.StatusNotFound {
		t.Errorf("a part sent to the app = %d, want 404", got)
	}

	if got := finishRecording(t, srv, board, rec, 90000, &owner); got != http.StatusNoContent {
		t.Fatalf("finish = %d", got)
	}
	if len(bucket.completed) != 1 || bucket.completed[0] != key+" upload-"+key {
		t.Errorf("completed = %v", bucket.completed)
	}
	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", nil))
	if len(list) != 1 || list[0]["bytes"] != float64(1234) || list[0]["durationMs"] != float64(90000) || list[0]["finished"] != true {
		t.Errorf("list = %v", list)
	}
}

func TestWithABucketDownloadIsASignedAddress(t *testing.T) {
	srv, a, _ := testApp(t)
	withBucket(a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/mp4")
	finishRecording(t, srv, board, rec, 1000, &owner)

	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(srv.URL + recPath(board, rec, "")) // a guest: no cookie
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	want := "https://bucket.test/" + rec + "/audio.mp4?name=Lekcja.mp4&type=audio/mp4"
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != want {
		t.Errorf("= %d %q, want a redirect to %q", resp.StatusCode, resp.Header.Get("Location"), want)
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("Cache-Control = %q: a signed address must not be cached", cc)
	}
}

func TestWithABucketDeleteRemovesTheObjectOrTheUpload(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	done := startRecording(t, srv, board, &owner, "audio/webm")
	finishRecording(t, srv, board, done, 1, &owner)
	going := startRecording(t, srv, board, &owner, "audio/webm")

	status(call(t, srv, "DELETE", recPath(board, done, ""), "", &owner))
	status(call(t, srv, "DELETE", recPath(board, going, ""), "", &owner))
	want := []string{done + "/audio.webm completed=true", going + "/audio.webm completed=false"}
	if fmt.Sprint(bucket.removed) != fmt.Sprint(want) {
		t.Errorf("removed %v, want %v", bucket.removed, want)
	}
}

func TestWithABucketDeletingABoardRemovesItsObjects(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	finishRecording(t, srv, board, rec, 1, &owner)

	status(call(t, srv, "DELETE", "/api/boards/"+board, "", &owner))
	if len(bucket.removed) != 1 || bucket.removed[0] != rec+"/audio.webm completed=true" {
		t.Errorf("removed %v", bucket.removed)
	}
}

func TestWithABucketThatRefusesNothingIsLeftBehind(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	bucket.startErr = errors.New("bucket down")
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	if got := status(call(t, srv, "POST", "/api/boards/"+board+"/recordings", `{"mime":"audio/webm"}`, &owner)); got != http.StatusBadGateway {
		t.Errorf("start with the bucket down = %d, want 502", got)
	}
	if list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &owner)); len(list) != 0 {
		t.Errorf("a recording was left: %v", list)
	}
}

func TestSweepWithABucketCompletesTheTornUpload(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")

	a.sweepRecordings(context.Background(), time.Now().Add(idleRecording+time.Minute))
	if len(bucket.completed) != 1 {
		t.Errorf("completed = %v", bucket.completed)
	}
	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", nil))
	if len(list) != 1 || list[0]["id"] != rec || list[0]["finished"] != true {
		t.Errorf("list = %v", list)
	}

	// A bucket that has no part of it: the recording is dropped.
	bucket.completeErr = recstore.ErrNoParts
	empty := startRecording(t, srv, board, &owner, "audio/webm")
	a.sweepRecordings(context.Background(), time.Now().Add(2*idleRecording))
	for _, r := range decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", nil)) {
		if r["id"] == empty {
			t.Errorf("the empty upload is kept: %v", r)
		}
	}
}

func TestPageMayReachTheBucketOnlyWhenThereIsOne(t *testing.T) {
	// The browser sends the parts to the bucket, so the CSP of the page must allow its origin.
	srv, a, _ := testApp(t)
	csp := func() string {
		resp, err := http.Get(srv.URL + "/healthz")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.Header.Get("Content-Security-Policy")
	}
	if strings.Contains(csp(), "r2.example") {
		t.Fatal("the CSP names a bucket that is not there")
	}
	a.bucketOrigin = "https://acct.r2.example"
	srv2 := httptest.NewServer(a.Handler())
	defer srv2.Close()
	resp, err := http.Get(srv2.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	got := resp.Header.Get("Content-Security-Policy")
	if !strings.Contains(got, "connect-src 'self' https://acct.r2.example ") {
		t.Errorf("CSP = %q", got)
	}
}

// --- the event log and the player's index (R-113, R-114) ------------------------------------------

// putObject sends one object of the event log: segment n of the recording (0 is the starting state).
func putEvents(t *testing.T, srv *httptest.Server, boardID, recID string, n int, body string, u *user) int {
	t.Helper()
	resp := call(t, srv, "POST", fmt.Sprintf("%s/%d", recPath(boardID, recID, "/events"), n), "", u)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return resp.StatusCode
	}
	m := decode(t, resp)
	return status(putTo(t, srv, m["url"].(string), []byte(body), u))
}

func playIndex(t *testing.T, srv *httptest.Server, boardID, recID string, u *user) map[string]any {
	t.Helper()
	resp := call(t, srv, "GET", recPath(boardID, recID, "/play"), "", u)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("play = %d", resp.StatusCode)
	}
	return decode(t, resp)
}

func TestEventLogOnDiskIsSentInSegmentsAndPlayedBack(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")

	if got := putEvents(t, srv, board, rec, 0, `{"v":1,"strokes":[]}`, &owner); got != http.StatusNoContent {
		t.Fatalf("snapshot = %d", got)
	}
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &owner), []byte("sound"), &owner))
	for n := 1; n <= 2; n++ {
		if got := putEvents(t, srv, board, rec, n, fmt.Sprintf(`[[%d,"a"]]`, n*10), &owner); got != http.StatusNoContent {
			t.Fatalf("segment %d = %d", n, got)
		}
	}
	// The index of a recording still going is not offered: it has no end yet.
	if got := status(call(t, srv, "GET", recPath(board, rec, "/play"), "", nil)); got != http.StatusConflict {
		t.Errorf("play of a recording in progress = %d, want 409", got)
	}
	finishRecording(t, srv, board, rec, 20000, &owner)

	idx := playIndex(t, srv, board, rec, nil) // a guest: no cookie
	if idx["v"] != float64(1) || idx["durationMs"] != float64(20000) || idx["mime"] != "audio/webm" || idx["name"] != "Lekcja" {
		t.Errorf("index = %v", idx)
	}
	segs := idx["segments"].([]any)
	if len(segs) != 2 {
		t.Fatalf("segments = %v", segs)
	}
	read := func(address string) string {
		resp := call(t, srv, "GET", address, "", nil)
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s = %d", address, resp.StatusCode)
		}
		return string(b)
	}
	if got := read(idx["snapshot"].(string)); got != `{"v":1,"strokes":[]}` {
		t.Errorf("snapshot = %q", got)
	}
	if got := read(segs[1].(string)); got != `[[20,"a"]]` {
		t.Errorf("segment 2 = %q", got)
	}
	if got := read(idx["audio"].(string)); got != "sound" {
		t.Errorf("audio = %q", got)
	}
}

func TestOnlyTheOwnerSendsEventsAndNumbersAreChecked(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")

	if got := putEvents(t, srv, board, rec, 1, "[]", &other); got != http.StatusForbidden {
		t.Errorf("events by another account = %d, want 403", got)
	}
	if got := putEvents(t, srv, board, rec, 1, "[]", nil); got != http.StatusUnauthorized {
		t.Errorf("events by a guest = %d, want 401", got)
	}
	for _, n := range []string{"-1", "x", fmt.Sprint(maxEventSegments + 1)} {
		if got := status(call(t, srv, "POST", recPath(board, rec, "/events/"+n), "", &owner)); got != http.StatusBadRequest {
			t.Errorf("segment %s = %d, want 400", n, got)
		}
	}
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &owner), []byte("x"), &owner))
	finishRecording(t, srv, board, rec, 1, &owner)
	if got := status(call(t, srv, "POST", recPath(board, rec, "/events/1"), "", &owner)); got != http.StatusConflict {
		t.Errorf("segment of a finished recording = %d, want 409", got)
	}
}

func TestPlayFilesAreOnlyTheOnesOfThisRecording(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	putEvents(t, srv, board, rec, 0, "{}", &owner)
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &owner), []byte("x"), &owner))
	finishRecording(t, srv, board, rec, 1, &owner)

	for _, name := range []string{"..%2f..%2fetc%2fpasswd", "events/x", "events/-1", "voice/..", "other", "events/1/2", ""} {
		if got := status(call(t, srv, "GET", recPath(board, rec, "/files/"+name), "", nil)); got != http.StatusNotFound {
			t.Errorf("file %q = %d, want 404", name, got)
		}
	}
	if got := status(call(t, srv, "GET", recPath(board, rec, "/files/snapshot"), "", nil)); got != http.StatusOK {
		t.Errorf("snapshot file = %d", got)
	}
}

func TestDeletingARecordingRemovesAllItsFiles(t *testing.T) {
	srv, a, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	putEvents(t, srv, board, rec, 0, "{}", &owner)
	putEvents(t, srv, board, rec, 1, "[]", &owner)
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &owner), []byte("x"), &owner))
	finishRecording(t, srv, board, rec, 1, &owner)
	if _, err := os.Stat(filepath.Join(a.recDir(), rec)); err != nil {
		t.Fatalf("the recording's directory is missing: %v", err)
	}
	status(call(t, srv, "DELETE", recPath(board, rec, ""), "", &owner))
	if _, err := os.Stat(filepath.Join(a.recDir(), rec)); !os.IsNotExist(err) {
		t.Errorf("files are left behind: %v", err)
	}
}

func TestWithABucketEventsAndPlaybackGoThroughSignedAddresses(t *testing.T) {
	srv, a, _ := testApp(t)
	withBucket(a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")

	resp := call(t, srv, "POST", recPath(board, rec, "/events/3"), "", &owner)
	if got := decode(t, resp)["url"]; got != "https://bucket.test/"+rec+"/events/3.json?put" {
		t.Errorf("events address = %v", got)
	}
	resp = call(t, srv, "POST", recPath(board, rec, "/events/0"), "", &owner)
	if got := decode(t, resp)["url"]; got != "https://bucket.test/"+rec+"/snapshot.json?put" {
		t.Errorf("snapshot address = %v", got)
	}
	// The app takes no events in this mode either.
	if got := status(putTo(t, srv, recPath(board, rec, "/events/3"), []byte("[]"), &owner)); got != http.StatusNotFound {
		t.Errorf("events sent to the app = %d, want 404", got)
	}
	finishRecording(t, srv, board, rec, 5000, &owner)

	idx := playIndex(t, srv, board, rec, nil)
	if idx["audio"] != "https://bucket.test/"+rec+"/audio.webm?get" || idx["snapshot"] != "https://bucket.test/"+rec+"/snapshot.json?get" {
		t.Errorf("index = %v", idx)
	}
	segs := idx["segments"].([]any)
	if len(segs) != 3 || segs[2] != "https://bucket.test/"+rec+"/events/3.json?get" {
		t.Errorf("segments = %v", segs)
	}
}

func TestWithABucketDeletingARecordingRemovesEverythingUnderItsPrefix(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	finishRecording(t, srv, board, rec, 1, &owner)
	status(call(t, srv, "DELETE", recPath(board, rec, ""), "", &owner))
	if len(bucket.prefixes) != 1 || bucket.prefixes[0] != rec+"/" {
		t.Errorf("prefixes removed = %v", bucket.prefixes)
	}
}

func TestPageMayPlayAudioFromTheBucket(t *testing.T) {
	// The player's <audio> reads from the bucket: media-src must allow it, and only when there is one.
	if strings.Contains(pageCSP(""), "media-src 'self' http") {
		t.Fatal("the CSP names a bucket that is not there")
	}
	if got := pageCSP("https://acct.r2.example"); !strings.Contains(got, "media-src 'self' https://acct.r2.example") {
		t.Errorf("CSP = %q", got)
	}
}

// --- renaming (R-113) ----------------------------------------------------------------------------

func TestTheOwnerRenamesARecording(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")

	if got := status(call(t, srv, "PATCH", recPath(board, rec, ""), `{"name":"  Ułamki, lekcja 3  "}`, &owner)); got != http.StatusNoContent {
		t.Fatalf("rename = %d", got)
	}
	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", nil))
	if len(list) != 1 || list[0]["name"] != "Ułamki, lekcja 3" {
		t.Errorf("list = %v", list)
	}
}

func TestOnlyTheOwnerRenamesAndTheNameIsChecked(t *testing.T) {
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	other := register(t, srv, "b@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")

	if got := status(call(t, srv, "PATCH", recPath(board, rec, ""), `{"name":"X"}`, &other)); got != http.StatusForbidden {
		t.Errorf("rename by another account = %d, want 403", got)
	}
	if got := status(call(t, srv, "PATCH", recPath(board, rec, ""), `{"name":"X"}`, nil)); got != http.StatusUnauthorized {
		t.Errorf("rename by a guest = %d, want 401", got)
	}
	for _, name := range []string{"", "   ", strings.Repeat("x", maxRecordingName+1)} {
		if got := status(call(t, srv, "PATCH", recPath(board, rec, ""), fmt.Sprintf(`{"name":%q}`, name), &owner)); got != http.StatusBadRequest {
			t.Errorf("name %q = %d, want 400", name, got)
		}
	}
	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &owner))
	if list[0]["name"] != "Lekcja" {
		t.Errorf("a refused rename changed the name: %v", list[0]["name"])
	}
}
