package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maciekgangus/inkroom/server/internal/store"
)

// The video rendered from a recording (R-115, ADR 0029): a renderer takes finished recordings from
// a queue through the job port, and the video it sends back is played and downloaded by everyone
// who may open the board.

const renderToken = "render-secret"

// renderer is a client of the job port.
type renderer struct {
	t   *testing.T
	srv *httptest.Server
}

func newRenderer(t *testing.T, a *app) *renderer {
	t.Helper()
	a.configureRender(renderToken)
	srv := httptest.NewServer(a.renderHandler())
	t.Cleanup(srv.Close)
	return &renderer{t, srv}
}

func (r *renderer) do(method, path, token string, body []byte) (int, []byte) {
	r.t.Helper()
	req, err := http.NewRequest(method, r.srv.URL+path, bytes.NewReader(body))
	if err != nil {
		r.t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		r.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

// claim takes the next job; ok is false when the queue is empty.
func (r *renderer) claim() (job map[string]any, ok bool) {
	r.t.Helper()
	code, b := r.do("POST", "/render/claim", renderToken, nil)
	if code == http.StatusNoContent {
		return nil, false
	}
	if code != http.StatusOK || json.Unmarshal(b, &job) != nil {
		r.t.Fatalf("claim = %d %s", code, b)
	}
	return job, true
}

func (r *renderer) post(job map[string]any, what, body string) int {
	r.t.Helper()
	code, _ := r.do("POST", fmt.Sprintf("/render/%s/%s/%s", job["board"], job["rec"], what), renderToken, []byte(body))
	return code
}

// finishedWithSound makes a finished recording with a few bytes of sound and returns its id.
func finishedWithSound(t *testing.T, srv *httptest.Server, board string, u user) string {
	t.Helper()
	rec := startRecording(t, srv, board, &u, "audio/webm")
	status(putTo(t, srv, partAddress(t, srv, board, rec, 1, &u), []byte("sound"), &u))
	if got := finishRecording(t, srv, board, rec, 30000, &u); got != http.StatusNoContent {
		t.Fatalf("finish = %d", got)
	}
	return rec
}

func videoStateOf(t *testing.T, srv *httptest.Server, board, rec string, u *user) map[string]any {
	t.Helper()
	for _, item := range decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", u)) {
		if item["id"] == rec {
			return item
		}
	}
	t.Fatalf("recording %s is not listed", rec)
	return nil
}

func TestWithoutARendererNoVideoIsQueued(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := finishedWithSound(t, srv, board, u)
	if got := videoStateOf(t, srv, board, rec, &u)["video"]; got != "" {
		t.Errorf("video = %q, want none", got)
	}
}

func TestOnlyTheRendererWithTheTokenUsesTheJobPort(t *testing.T) {
	srv, a, _ := testApp(t)
	r := newRenderer(t, a)
	for _, token := range []string{"", "wrong", renderToken + "x"} {
		if code, _ := r.do("POST", "/render/claim", token, nil); code != http.StatusUnauthorized {
			t.Errorf("token %q: claim = %d, want 401", token, code)
		}
	}
	// With no token configured there is no one to let in.
	a.renderToken = ""
	if code, _ := r.do("POST", "/render/claim", "", nil); code != http.StatusUnauthorized {
		t.Errorf("no token set: claim = %d, want 401", code)
	}
	_ = srv
}

func TestAFinishedRecordingGetsAVideoFromTheRenderer(t *testing.T) {
	srv, a, _ := testApp(t)
	r := newRenderer(t, a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	if _, ok := r.claim(); ok {
		t.Fatal("nothing is queued yet")
	}
	rec := finishedWithSound(t, srv, board, owner)
	if got := videoStateOf(t, srv, board, rec, &owner)["video"]; got != store.VideoQueued {
		t.Fatalf("after finishing: video = %v", got)
	}

	job, ok := r.claim()
	if !ok || job["rec"] != rec || job["board"] != board || job["durationMs"] != float64(30000) {
		t.Fatalf("job = %v", job)
	}
	if got := videoStateOf(t, srv, board, rec, &owner); got["video"] != store.VideoRendering {
		t.Fatalf("after the claim: %v", got)
	}
	if code := r.post(job, "progress", `{"percent":40}`); code != http.StatusNoContent {
		t.Fatalf("progress = %d", code)
	}
	if got := videoStateOf(t, srv, board, rec, &owner); got["videoProgress"] != float64(40) {
		t.Errorf("progress = %v", got["videoProgress"])
	}

	// On this server's disk the video comes through the job port.
	upload := job["upload"].(string)
	if code, _ := r.do("PUT", upload, renderToken, []byte("MP4DATA")); code != http.StatusNoContent {
		t.Fatalf("upload = %d", code)
	}
	if code := r.post(job, "done", `{"bytes":7}`); code != http.StatusNoContent {
		t.Fatalf("done = %d", code)
	}
	got := videoStateOf(t, srv, board, rec, nil) // a guest sees it too
	if got["video"] != store.VideoReady || got["videoBytes"] != float64(7) || got["videoProgress"] != float64(100) {
		t.Fatalf("ready: %v", got)
	}

	// The player's index points at the video, and the video is read by a guest, with Range.
	idx := playIndex(t, srv, board, rec, nil)
	if idx["videoState"] != store.VideoReady || idx["video"] == nil {
		t.Fatalf("index = %v", idx)
	}
	resp := call(t, srv, "GET", idx["video"].(string), "", nil)
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(b) != "MP4DATA" || resp.Header.Get("Content-Type") != "video/mp4" {
		t.Errorf("video = %d %q %q", resp.StatusCode, b, resp.Header.Get("Content-Type"))
	}
	req, _ := http.NewRequest("GET", srv.URL+idx["video"].(string), nil)
	req.Header.Set("Range", "bytes=3-5")
	part, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	pb, _ := io.ReadAll(part.Body)
	part.Body.Close()
	if part.StatusCode != http.StatusPartialContent || string(pb) != "DAT" {
		t.Errorf("range = %d %q", part.StatusCode, pb)
	}

	// The download is an attachment named after the recording.
	dl := call(t, srv, "GET", recPath(board, rec, "/video"), "", nil)
	db, _ := io.ReadAll(dl.Body)
	dl.Body.Close()
	if dl.StatusCode != http.StatusOK || string(db) != "MP4DATA" || !strings.Contains(dl.Header.Get("Content-Disposition"), "Lekcja.mp4") {
		t.Errorf("download = %d %q %q", dl.StatusCode, db, dl.Header.Get("Content-Disposition"))
	}

	// Deleting the recording takes the video with it.
	file := filepath.Join(a.recDir(), rec, "video.mp4")
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("the video is not on disk: %v", err)
	}
	status(call(t, srv, "DELETE", recPath(board, rec, ""), "", &owner))
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Errorf("the video is still there: %v", err)
	}
}

func TestAVideoThatIsNotReadyIsNotServed(t *testing.T) {
	srv, a, _ := testApp(t)
	r := newRenderer(t, a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := finishedWithSound(t, srv, board, owner)
	if got := status(call(t, srv, "GET", recPath(board, rec, "/video"), "", nil)); got != http.StatusConflict {
		t.Errorf("download of a queued video = %d, want 409", got)
	}
	if got := status(call(t, srv, "GET", recPath(board, rec, "/files/video"), "", nil)); got != http.StatusNotFound {
		t.Errorf("file of a queued video = %d, want 404", got)
	}
	if idx := playIndex(t, srv, board, rec, nil); idx["video"] != nil || idx["videoState"] != store.VideoQueued {
		t.Errorf("index = %v", idx)
	}
	job, _ := r.claim()
	// The disk upload is taken only from a recording that is being rendered, and only with the token.
	if code, _ := r.do("PUT", job["upload"].(string), "", []byte("x")); code != http.StatusUnauthorized {
		t.Errorf("upload without a token = %d", code)
	}
}

func TestAFailedRenderingIsTriedAgainAndThenGivenUp(t *testing.T) {
	srv, a, _ := testApp(t)
	r := newRenderer(t, a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := finishedWithSound(t, srv, board, owner)
	for attempt := 1; attempt <= maxVideoAttempts; attempt++ {
		job, ok := r.claim()
		if !ok {
			t.Fatalf("attempt %d: nothing to take", attempt)
		}
		if code := r.post(job, "fail", `{"reason":"chromium crashed"}`); code != http.StatusNoContent {
			t.Fatalf("fail = %d", code)
		}
	}
	if _, ok := r.claim(); ok {
		t.Error("a video that failed every time is offered again")
	}
	if got := videoStateOf(t, srv, board, rec, &owner)["video"]; got != store.VideoFailed {
		t.Errorf("video = %v, want failed", got)
	}
}

func TestStalledRenderingsAreQueuedAgain(t *testing.T) {
	srv, a, _ := testApp(t)
	r := newRenderer(t, a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := finishedWithSound(t, srv, board, owner)
	r.claim()
	a.sweepRecordings(t.Context(), time.Now().Add(videoStale+time.Minute))
	if got := videoStateOf(t, srv, board, rec, &owner)["video"]; got != store.VideoQueued {
		t.Errorf("video = %v, want queued again", got)
	}
}

func TestRecordingsMadeBeforeTheRendererExistedAreQueuedWhenItIsTurnedOn(t *testing.T) {
	srv, a, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := finishedWithSound(t, srv, board, owner)
	newRenderer(t, a)
	if got := videoStateOf(t, srv, board, rec, &owner)["video"]; got != store.VideoQueued {
		t.Errorf("video = %v, want queued", got)
	}
}

func TestWithABucketTheRendererSendsTheVideoStraightToIt(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	r := newRenderer(t, a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	finishRecording(t, srv, board, rec, 1000, &owner)

	job, ok := r.claim()
	if !ok || job["upload"] != "https://bucket.test/"+rec+"/video.mp4?put" {
		t.Fatalf("job = %v", job)
	}
	r.post(job, "done", `{"bytes":99}`)
	idx := playIndex(t, srv, board, rec, nil)
	if idx["video"] != "https://bucket.test/"+rec+"/video.mp4?get" {
		t.Errorf("video address = %v", idx["video"])
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(srv.URL + recPath(board, rec, "/video"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if loc := resp.Header.Get("Location"); !strings.Contains(loc, "/video.mp4?name=Lekcja.mp4&type=video/mp4") {
		t.Errorf("download redirects to %q", loc)
	}
	_ = bucket
}

func TestAVideoFinishedAfterTheRecordingWasDeletedIsRemoved(t *testing.T) {
	srv, a, _ := testApp(t)
	bucket := withBucket(a)
	r := newRenderer(t, a)
	owner := register(t, srv, "a@example.com")
	board := createBoard(t, srv, owner, "Matma")
	rec := startRecording(t, srv, board, &owner, "audio/webm")
	finishRecording(t, srv, board, rec, 1000, &owner)
	job, _ := r.claim()
	status(call(t, srv, "DELETE", recPath(board, rec, ""), "", &owner))
	bucket.prefixes = nil

	if code := r.post(job, "done", `{"bytes":99}`); code != http.StatusNotFound {
		t.Fatalf("done of a deleted recording = %d, want 404", code)
	}
	if len(bucket.prefixes) == 0 || bucket.prefixes[0] != rec+"/" {
		t.Errorf("what the renderer sent was left in the bucket: %v", bucket.prefixes)
	}
}

func TestRenderAuthRequiresBearerPrefix(t *testing.T) {
	_, a, _ := testApp(t)
	r := newRenderer(t, a)
	req, err := http.NewRequest("POST", r.srv.URL+"/render/claim", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", renderToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("raw token without Bearer prefix = %d, want 401", resp.StatusCode)
	}
}

func TestRenderDoneRejectsWrongBoardAndKeepsFiles(t *testing.T) {
	srv, a, _ := testApp(t)
	r := newRenderer(t, a)
	owner := register(t, srv, "a@example.com")
	board1 := createBoard(t, srv, owner, "Matma")
	board2 := createBoard(t, srv, owner, "Fizyka")
	rec := finishedWithSound(t, srv, board1, owner)

	if _, ok := r.claim(); !ok {
		t.Fatal("expected job to claim")
	}
	audioFile := filepath.Join(a.recDir(), rec, "audio.webm")
	if _, err := os.Stat(audioFile); err != nil {
		t.Fatalf("expected recording audio on disk: %v", err)
	}

	if code, _ := r.do("POST", "/render/"+board2+"/"+rec+"/done", renderToken, []byte(`{"bytes":7}`)); code != http.StatusNotFound {
		t.Fatalf("done on wrong board = %d, want 404", code)
	}
	if got := videoStateOf(t, srv, board1, rec, &owner)["video"]; got != store.VideoRendering {
		t.Errorf("video state on real board = %v, want %q", got, store.VideoRendering)
	}
	if _, err := os.Stat(audioFile); err != nil {
		t.Errorf("recording files were deleted after wrong-board done: %v", err)
	}
}
