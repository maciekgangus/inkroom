package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Lesson recording, stage 1 (R-112): chunks go to the app server's disk.

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
	id, _ := decode(t, resp)["id"].(string)
	if len(id) != 32 {
		t.Fatalf("bad recording id %q", id)
	}
	return id
}

func sendChunk(t *testing.T, srv *httptest.Server, boardID, recID string, offset int, data string, u *user) *http.Response {
	t.Helper()
	req, err := http.NewRequest("PUT", srv.URL+"/api/boards/"+boardID+"/recordings/"+recID+"/chunk?offset="+strconv.Itoa(offset), strings.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	if u != nil {
		req.AddCookie(u.cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func download(t *testing.T, srv *httptest.Server, boardID, recID string, u *user) *http.Response {
	t.Helper()
	return call(t, srv, "GET", "/api/boards/"+boardID+"/recordings/"+recID, "", u)
}

func TestRecordingIsSavedChunkByChunkAndDownloaded(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher := register(t, srv, "a@example.com")
	board := createBoard(t, srv, teacher, "Matma")
	rec := startRecording(t, srv, board, &teacher, "video/webm;codecs=vp9,opus")

	if got := status(sendChunk(t, srv, board, rec, 0, "AAAA", &teacher)); got != http.StatusNoContent {
		t.Fatalf("first chunk = %d", got)
	}
	if got := status(sendChunk(t, srv, board, rec, 4, "BBBBBB", &teacher)); got != http.StatusNoContent {
		t.Fatalf("second chunk = %d", got)
	}
	if got := status(call(t, srv, "POST", "/api/boards/"+board+"/recordings/"+rec+"/finish", `{"durationMs":65000}`, &teacher)); got != http.StatusNoContent {
		t.Fatalf("finish = %d", got)
	}

	resp := download(t, srv, board, rec, &teacher)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "AAAABBBBBB" {
		t.Fatalf("download = %d %q", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "video/webm" {
		t.Errorf("Content-Type = %q, want video/webm", ct)
	}
	if cd := resp.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment") || !strings.Contains(cd, ".webm") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}

	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &teacher))
	if len(list) != 1 {
		t.Fatalf("list = %v", list)
	}
	r := list[0]
	if r["id"] != rec || r["name"] != "Lekcja" || r["bytes"] != float64(10) || r["durationMs"] != float64(65000) || r["finished"] != true {
		t.Errorf("listed recording = %v", r)
	}
}

func TestMP4RecordingKeepsItsType(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher := register(t, srv, "a@example.com")
	board := createBoard(t, srv, teacher, "Matma")
	rec := startRecording(t, srv, board, &teacher, "video/mp4;codecs=avc1.42E01E,mp4a.40.2")
	status(sendChunk(t, srv, board, rec, 0, "x", &teacher))
	resp := download(t, srv, board, rec, &teacher)
	resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "video/mp4" {
		t.Errorf("Content-Type = %q, want video/mp4", ct)
	}
	if cd := resp.Header.Get("Content-Disposition"); !strings.Contains(cd, ".mp4") {
		t.Errorf("Content-Disposition = %q", cd)
	}
}

func TestRecordingNeedsALoggedInUser(t *testing.T) {
	srv, _, _ := testApp(t)
	teacher := register(t, srv, "a@example.com")
	board := createBoard(t, srv, teacher, "Matma")
	rec := startRecording(t, srv, board, &teacher, "video/webm")

	for name, resp := range map[string]*http.Response{
		"start":    call(t, srv, "POST", "/api/boards/"+board+"/recordings", `{"mime":"video/webm"}`, nil),
		"chunk":    sendChunk(t, srv, board, rec, 0, "x", nil),
		"finish":   call(t, srv, "POST", "/api/boards/"+board+"/recordings/"+rec+"/finish", `{"durationMs":1}`, nil),
		"list":     call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", nil),
		"download": download(t, srv, board, rec, nil),
	} {
		if got := status(resp); got != http.StatusUnauthorized {
			t.Errorf("%s without a session = %d, want 401", name, got)
		}
	}
}

func TestAnyLoggedInUserMayRecordListAndDownload(t *testing.T) {
	// R-112: no check that the caller owns the board.
	srv, _, _ := testApp(t)
	owner := register(t, srv, "a@example.com")
	guest := register(t, srv, "b@example.com")
	board := createBoard(t, srv, owner, "Matma")

	rec := startRecording(t, srv, board, &guest, "video/webm")
	if got := status(sendChunk(t, srv, board, rec, 0, "hi", &guest)); got != http.StatusNoContent {
		t.Fatalf("chunk by a non-owner = %d", got)
	}
	if list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &owner)); len(list) != 1 {
		t.Errorf("the board owner sees %v", list)
	}
	resp := download(t, srv, board, rec, &owner)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "hi" {
		t.Errorf("the board owner downloads %d %q", resp.StatusCode, body)
	}
}

func TestOnlyTheRecorderAddsToARecording(t *testing.T) {
	srv, _, _ := testApp(t)
	a := register(t, srv, "a@example.com")
	b := register(t, srv, "b@example.com")
	board := createBoard(t, srv, a, "Matma")
	rec := startRecording(t, srv, board, &a, "video/webm")

	if got := status(sendChunk(t, srv, board, rec, 0, "evil", &b)); got != http.StatusForbidden {
		t.Errorf("chunk by someone else = %d, want 403", got)
	}
	if got := status(call(t, srv, "POST", "/api/boards/"+board+"/recordings/"+rec+"/finish", `{"durationMs":1}`, &b)); got != http.StatusForbidden {
		t.Errorf("finish by someone else = %d, want 403", got)
	}
}

func TestChunkAtTheWrongOffsetIsRefusedWithTheCurrentSize(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "video/webm")
	status(sendChunk(t, srv, board, rec, 0, "AAAA", &u))

	// A retry of a chunk that already arrived (the answer got lost) must not be appended twice.
	resp := sendChunk(t, srv, board, rec, 0, "AAAA", &u)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("repeated chunk = %d, want 409", resp.StatusCode)
	}
	if size := decode(t, resp)["size"]; size != float64(4) {
		t.Errorf("size in the 409 = %v, want 4", size)
	}
	// A gap is refused too.
	if got := status(sendChunk(t, srv, board, rec, 9, "CC", &u)); got != http.StatusConflict {
		t.Errorf("chunk after a gap = %d, want 409", got)
	}
	resp = download(t, srv, board, rec, &u)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(body) != "AAAA" {
		t.Errorf("file = %q, want AAAA", body)
	}
}

func TestChunkOffsetMustBeANumber(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "video/webm")
	req, _ := http.NewRequest("PUT", srv.URL+"/api/boards/"+board+"/recordings/"+rec+"/chunk?offset=x", strings.NewReader("a"))
	req.AddCookie(u.cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if got := status(resp); got != http.StatusBadRequest {
		t.Errorf("bad offset = %d, want 400", got)
	}
}

func TestRecordingMustBeVideoOfAKnownType(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	for _, mime := range []string{"", "text/html", "image/png", "video/x-flv"} {
		if got := status(call(t, srv, "POST", "/api/boards/"+board+"/recordings", `{"mime":"`+mime+`"}`, &u)); got != http.StatusBadRequest {
			t.Errorf("mime %q = %d, want 400", mime, got)
		}
	}
}

func TestRecordingOfAMissingBoardIsNotFound(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	if got := status(call(t, srv, "POST", "/api/boards/"+strings.Repeat("0", 32)+"/recordings", `{"mime":"video/webm"}`, &u)); got != http.StatusNotFound {
		t.Errorf("= %d, want 404", got)
	}
}

func TestRecordingIsReachedOnlyThroughItsOwnBoard(t *testing.T) {
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	one := createBoard(t, srv, u, "Jeden")
	two := createBoard(t, srv, u, "Dwa")
	rec := startRecording(t, srv, one, &u, "video/webm")
	status(sendChunk(t, srv, one, rec, 0, "x", &u))

	if got := status(download(t, srv, two, rec, &u)); got != http.StatusNotFound {
		t.Errorf("download through another board = %d, want 404", got)
	}
	if got := status(sendChunk(t, srv, two, rec, 1, "y", &u)); got != http.StatusNotFound {
		t.Errorf("chunk through another board = %d, want 404", got)
	}
	if list := decodeList(t, call(t, srv, "GET", "/api/boards/"+two+"/recordings", "", &u)); len(list) != 0 {
		t.Errorf("the other board lists %v", list)
	}
}

func TestUnfinishedRecordingIsListedWithWhatArrived(t *testing.T) {
	// A torn recording (closed tab, no network) stays as a file with what got there.
	srv, _, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "video/webm")
	status(sendChunk(t, srv, board, rec, 0, "12345", &u))

	list := decodeList(t, call(t, srv, "GET", "/api/boards/"+board+"/recordings", "", &u))
	if len(list) != 1 || list[0]["finished"] != false || list[0]["bytes"] != float64(5) {
		t.Errorf("list = %v", list)
	}
}

func TestRecordingFileLivesInTheRecordingsDirectory(t *testing.T) {
	srv, a, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "video/webm")
	status(sendChunk(t, srv, board, rec, 0, "data", &u))

	got, err := os.ReadFile(filepath.Join(a.recDir, rec+".webm"))
	if err != nil || !bytes.Equal(got, []byte("data")) {
		t.Errorf("file = %q, %v", got, err)
	}
}

func TestDeletingABoardRemovesItsRecordingFiles(t *testing.T) {
	srv, a, _ := testApp(t)
	u := register(t, srv, "a@example.com")
	board := createBoard(t, srv, u, "Matma")
	rec := startRecording(t, srv, board, &u, "video/webm")
	status(sendChunk(t, srv, board, rec, 0, "data", &u))

	if got := status(call(t, srv, "DELETE", "/api/boards/"+board, "", &u)); got != http.StatusNoContent {
		t.Fatalf("delete board = %d", got)
	}
	if _, err := os.Stat(filepath.Join(a.recDir, rec+".webm")); !os.IsNotExist(err) {
		t.Errorf("the file is still there: %v", err)
	}
}
